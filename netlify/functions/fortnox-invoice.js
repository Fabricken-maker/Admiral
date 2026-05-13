/**
 * Admiral → Fortnox fakturaskapare
 * POST /api/fortnox/invoice  { month, user_id? }
 * Kräver X-API-Key (admin-scope)
 *
 * Env vars:
 *   FORTNOX_ACCESS_TOKEN  — hämtas från Fortnox → Inställningar → API
 *   FORTNOX_CLIENT_SECRET — din apps client secret
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const FORTNOX_TOKEN  = process.env.FORTNOX_ACCESS_TOKEN;
const FORTNOX_BASE   = 'https://api.fortnox.se/3';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

async function authenticate(event) {
  const apiKey = event.headers['x-api-key'] || event.headers['X-API-Key'];
  if (!apiKey) throw new Error('X-API-Key saknas');
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const { data } = await supabase.from('mcp_api_keys').select('scope, active').eq('key_hash', hash).single();
  if (!data?.active || data.scope !== 'admin') throw new Error('Admin-nyckel krävs');
}

async function fortnoxGet(path) {
  const res = await fetch(`${FORTNOX_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${FORTNOX_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  const json = await res.json();
  if (json.ErrorInformation) throw new Error(json.ErrorInformation.message);
  return json;
}

async function fortnoxPost(path, body) {
  const res = await fetch(`${FORTNOX_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FORTNOX_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (json.ErrorInformation) throw new Error(json.ErrorInformation.message);
  return json;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!FORTNOX_TOKEN) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'FORTNOX_ACCESS_TOKEN ej konfigurerat. Lägg till i Netlify env vars.' }) };
  }

  try { await authenticate(event); }
  catch (e) { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) }; }

  try {
    const { month, user_id, dry_run = false } = JSON.parse(event.body || '{}');

    const now = new Date();
    const targetMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart  = `${targetMonth}-01`;
    const monthEnd    = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    // Hämta budgetplaner för månaden
    let query = supabase
      .from('budget_plans')
      .select(`id, campaign_name, monthly_budget, total_spent, users(id, email, name, company_name)`)
      .lte('month_start', monthEnd)
      .gte('month_end', monthStart);

    if (user_id) query = query.eq('user_id', user_id);

    const { data: plans, error } = await query;
    if (error) throw error;
    if (!plans?.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'Inga planer att fakturera', month: targetMonth }) };

    // Gruppera per kund
    const byCustomer = {};
    for (const p of plans) {
      const uid = p.users.id;
      if (!byCustomer[uid]) byCustomer[uid] = { user: p.users, plans: [] };
      byCustomer[uid].plans.push(p);
    }

    const results = [];

    for (const [uid, { user, plans: customerPlans }] of Object.entries(byCustomer)) {
      const customerName = user.name || user.company_name || user.email;
      const invoiceRows = customerPlans.map(p => ({
        Description: `Admiral — ${p.campaign_name} (${targetMonth})`,
        DeliveredQuantity: '1',
        Price: Math.round(p.monthly_budget),
        VAT: 25
      }));

      if (dry_run) {
        results.push({
          dry_run: true,
          customer: customerName,
          email: user.email,
          rows: invoiceRows,
          total: invoiceRows.reduce((s, r) => s + r.Price, 0)
        });
        continue;
      }

      // Hitta eller skapa kund i Fortnox
      let fortnoxCustomerNumber = null;
      try {
        const searchRes = await fortnoxGet(`/customers?email=${encodeURIComponent(user.email)}`);
        const existing = searchRes.Customers?.[0];
        if (existing) {
          fortnoxCustomerNumber = existing.CustomerNumber;
        } else {
          const newCustomer = await fortnoxPost('/customers', {
            Customer: { Name: customerName, Email: user.email, CountryCode: 'SE' }
          });
          fortnoxCustomerNumber = newCustomer.Customer.CustomerNumber;
        }
      } catch (e) {
        results.push({ customer: customerName, error: `Kunde inte hitta/skapa kund: ${e.message}` });
        continue;
      }

      // Skapa faktura
      try {
        const invoiceRes = await fortnoxPost('/invoices', {
          Invoice: {
            CustomerNumber: fortnoxCustomerNumber,
            InvoiceDate: now.toISOString().split('T')[0],
            DueDate: new Date(now.getTime() + 30 * 86400000).toISOString().split('T')[0],
            InvoiceRows: invoiceRows,
            Remarks: `Admiral automatisk faktura ${targetMonth}`
          }
        });

        results.push({
          customer: customerName,
          email: user.email,
          invoice_number: invoiceRes.Invoice.DocumentNumber,
          total_sek: invoiceRes.Invoice.Total,
          due_date: invoiceRes.Invoice.DueDate
        });
      } catch (e) {
        results.push({ customer: customerName, error: `Fakturaskapande misslyckades: ${e.message}` });
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ month: targetMonth, dry_run, invoices: results })
    };

  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
