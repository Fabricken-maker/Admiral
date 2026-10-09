// Agent 1 — Infra & åtkomst.
// Netlify-deploy och Functions svarar, endpoints ger rätt statuskod, Supabase nås,
// auth fungerar, Meta-tokens är giltiga och inte nära utgång, miljövariabler finns.
// Tillåten reparation: förnya Meta-token (fb_exchange_token) som snart går ut.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pass, fail, skip } from '../lib/result.js';
import { fetchJson } from '../lib/http.js';
import { REQUIRED_TABLES, TABLE_USAGE, REQUIRED_NETLIFY_ENV, EXPECTED_SCHEDULES } from '../config.js';

const A = 'infra';

const PAGES = ['/', '/login.html', '/dashboard.html', '/admin.html'];

// Endpoints som dashboarden och admin-vyn läser. Utan token → 401, med admin-token → 200.
const ENDPOINTS = [
  { path: '/api/user', shape: (j) => j && (j.email || j.user) },
  { path: '/api/meta/token-status', shape: (j) => j && typeof j.connected === 'boolean' },
  { path: '/api/meta/accounts', shape: (j) => Array.isArray(j?.accounts) },
  { path: '/api/meta/campaigns', shape: (j) => Array.isArray(j?.campaigns) },
  { path: '/api/timeline', shape: (j) => Array.isArray(j?.campaigns) && Array.isArray(j?.daily_spend) },
  { path: '/api/reports', shape: (j) => Array.isArray(j?.reports) },
  { path: '/api/conversions', shape: (j) => j && !j.error },
  { path: '/api/campaign-goals', shape: (j) => j && !j.error },
  { path: '/api/campaign-assets', shape: (j) => j && !j.error },
  { path: '/api/ga4/insights?days=7', shape: (j) => j && !j.error },
  { path: '/api/admin/customers', shape: (j) => j && !j.error },
  { path: '/api/admin/campaigns', shape: (j) => j && !j.error },
];

export async function run(ctx) {
  const results = [];
  const { admiral, supabase, config } = ctx;

  // ── Sidor ──────────────────────────────────────────────
  await Promise.all(PAGES.map(async (p) => {
    const id = `infra.page ${p}`;
    const recheck = async () => {
      const r = await admiral.api(p);
      const html = (r.headers?.get?.('content-type') || '').includes('text/html');
      return r.status === 200 && html ? { ok: true } : { ok: false, cause: `HTTP ${r.status || r.error}` };
    };
    const r = await recheck();
    results.push(r.ok ? pass(A, id) : fail(A, id, `Sidan ${p} svarar ${r.cause}`, { where: `${config.baseUrl}${p}`, recheck }));
  }));

  // ── Endpoints utan och med auth ────────────────────────
  const adminUser = await ctx.getAdminUser();
  const adminToken = adminUser ? admiral.tokenFor(adminUser) : null;
  if (!adminUser) results.push(fail(A, 'infra.admin-user', `Admin-kontot ${config.adminEmail} finns inte i users`, { where: 'Supabase users' }));

  await Promise.all(ENDPOINTS.map(async (ep) => {
    const unauthId = `infra.endpoint ${ep.path} utan token`;
    const unauthCheck = async () => {
      const r = await admiral.api(ep.path);
      return r.status === 401 ? { ok: true } : { ok: false, cause: `${ep.path} utan token gav HTTP ${r.status || r.error}, väntat 401` };
    };
    const u = await unauthCheck();
    results.push(u.ok ? pass(A, unauthId) : fail(A, unauthId, u.cause, { where: `netlify/functions (${ep.path})`, recheck: unauthCheck }));

    if (!adminToken) return;
    const authId = `infra.endpoint ${ep.path} som admin`;
    const authCheck = async () => {
      const r = await admiral.api(ep.path, { token: adminToken });
      if (r.status !== 200) return { ok: false, cause: `${ep.path} gav HTTP ${r.status || r.error}${r.json?.error ? ` (${r.json.error})` : ''}, väntat 200` };
      if (!ep.shape(r.json)) return { ok: false, cause: `${ep.path} svarade 200 men med oväntat innehåll` };
      return { ok: true, ms: r.ms };
    };
    const a = await authCheck();
    results.push(a.ok ? pass(A, authId) : fail(A, authId, a.cause, { where: `netlify/functions (${ep.path})`, recheck: authCheck }));
  }));

  // ── Auth ───────────────────────────────────────────────
  if (adminToken) {
    const id = 'infra.auth jwt';
    const recheck = async () => {
      const r = await admiral.api('/api/user', { token: adminToken });
      const email = r.json?.email || r.json?.user?.email;
      if (r.status !== 200) return { ok: false, cause: `Giltigt JWT avvisades (HTTP ${r.status}) — JWT_SECRET i Netlify matchar inte` };
      if (email && email !== adminUser.email) return { ok: false, cause: `/api/user returnerade fel konto (${email})` };
      const bad = await admiral.api('/api/user', { token: `${adminToken.slice(0, -4)}AAAA` });
      if (bad.status !== 401) return { ok: false, cause: `JWT med fel signatur accepterades (HTTP ${bad.status})` };
      return { ok: true };
    };
    const r = await recheck();
    results.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/api-user.js / JWT_SECRET', recheck }));
  }
  {
    const id = 'infra.auth login';
    const recheck = async () => {
      // Påhittat konto: ger 401 utan att röra något riktigt konto.
      const r = await admiral.api('/auth/login', { method: 'POST', body: { email: 'healthcheck-probe@admiralai.invalid', password: crypto.randomUUID() } });
      return r.status === 401 ? { ok: true } : { ok: false, cause: `Inloggning med fel lösenord gav HTTP ${r.status || r.error}, väntat 401` };
    };
    const r = await recheck();
    results.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: 'netlify/functions/auth-login-supabase.js', recheck }));
  }

  // ── Supabase ───────────────────────────────────────────
  await Promise.all([...REQUIRED_TABLES, 'admiral_healthchecks'].map(async (t) => {
    const id = `infra.supabase ${t}`;
    const recheck = async () => {
      const r = await supabase.probe(t);
      if (r.ok) return { ok: true };
      const missing = r.status === 404 || /does not exist|Could not find/i.test(r.message);
      return { ok: false, cause: missing ? `Tabellen ${t} saknas i databasen` : `Tabellen ${t} går inte att läsa (HTTP ${r.status} ${r.message})` };
    };
    const r = await recheck();
    results.push(r.ok ? pass(A, id) : fail(A, id, r.cause, { where: TABLE_USAGE[t] || `Supabase public.${t}`, recheck }));
  }));

  // ── Meta-tokens ────────────────────────────────────────
  results.push(...await checkMetaTokens(ctx));

  // ── Netlify: deploy, schemaläggning, miljövariabler ────
  results.push(...await checkNetlify(ctx));

  return results;
}

async function checkMetaTokens(ctx) {
  const { supabase, meta, config } = ctx;
  const out = [];
  const rows = await supabase.select('meta_tokens', 'select=id,user_id,expires_at,meta_user_id,token_secret_id,users!inner(email,company_name,status)&users.status=eq.active');
  for (const row of rows) {
    out.push(await checkTokenEncrypted(ctx, row));
    const who = `${row.users.email}${row.users.company_name ? ` (${row.users.company_name})` : ''}`;
    const id = `infra.meta-token user ${row.user_id}`;
    const where = `meta_tokens user_id ${row.user_id}`;
    const inspect = async () => {
      const [cur] = await supabase.rpc('meta_token_get', { p_user_id: row.user_id });
      const d = await meta.debugToken(cur.access_token);
      const exp = d.expires_at ? new Date(d.expires_at * 1000) : null; // 0 = utgånget/aldrig
      const dataExp = d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000) : null;
      const daysLeft = exp ? Math.floor((exp - Date.now()) / 86400000) : null;
      const dataDays = dataExp ? Math.floor((dataExp - Date.now()) / 86400000) : null;
      return { d, exp, daysLeft, dataExp, dataDays, token: cur.access_token, dbExpires: cur.expires_at };
    };
    const verdict = (s) => {
      if (!s.d.is_valid) return { ok: false, cause: `Meta-token för ${who} är ogiltigt${s.dbExpires ? ` (utgångsdatum ${s.dbExpires.slice(0, 10)})` : ''}`, renewable: false };
      if (!(s.d.scopes || []).includes('ads_read')) return { ok: false, cause: `Meta-token för ${who} saknar behörigheten ads_read`, renewable: false };
      if (s.dataDays !== null && s.dataDays <= config.tokenWarnDays) return { ok: false, cause: `Metas dataåtkomst för ${who} upphör ${s.dataExp.toISOString().slice(0, 10)} (om ${s.dataDays} dagar)`, renewable: false };
      if (s.daysLeft !== null && s.daysLeft <= config.tokenWarnDays) return { ok: false, cause: `Meta-token för ${who} går ut ${s.exp.toISOString().slice(0, 10)} (om ${s.daysLeft} dagar)`, renewable: true };
      return { ok: true };
    };
    const recheck = async () => verdict(await inspect());

    let state;
    try { state = await inspect(); } catch (e) {
      out.push(fail(A, id, `Kunde inte kontrollera Meta-token för ${who}: ${e.message}`, { where, recheck }));
      continue;
    }
    const v = verdict(state);
    if (v.ok) { out.push(pass(A, id)); continue; }

    const result = fail(A, id, v.cause, { where, recheck, human: !v.renewable });
    if (v.renewable) {
      if (ctx.dryRun) {
        result.action = { kind: 'token-renewal', description: `Förnya Meta-token för ${who}`, ok: false, skipped: 'torrkörning' };
        result.human = true;
      } else {
        result.action = await renewToken(ctx, row, who, state);
        result.human = !result.action.ok;
        if (!result.action.ok) result.cause = `${v.cause}; automatisk förnyelse misslyckades: ${result.action.error}`;
      }
    }
    out.push(result);
  }
  return out;
}

// Modul D: Meta-token ska ligga krypterade i Supabase Vault. Ett okrypterat token flyttas dit
// (samma token, samma utgångsdatum) via meta_token_put.
async function checkTokenEncrypted(ctx, row) {
  const who = `${row.users.email}${row.users.company_name ? ` (${row.users.company_name})` : ''}`;
  const id = `infra.meta-token krypterat user ${row.user_id}`;
  if (row.token_secret_id) return pass(A, id);
  const recheck = async () => {
    const [cur] = await ctx.supabase.select('meta_tokens', `select=token_secret_id&id=eq.${row.id}`);
    return cur?.token_secret_id ? { ok: true } : { ok: false, cause: `Meta-token för ${who} är fortfarande okrypterat` };
  };
  const result = fail(A, id, `Meta-token för ${who} lagras okrypterat`, { where: `meta_tokens user_id ${row.user_id} (access_token)`, human: false, recheck });
  const action = { kind: 'encrypt-token', description: `Flytta Meta-token för ${who} till Supabase Vault`, before: { encrypted: false } };
  if (!(await vaultCodeLive(ctx))) {
    result.cause += '. Krypteringen görs först när Modul D (läsning via Vault) är driftsatt i Admiral';
    return result;
  }
  if (ctx.dryRun) result.action = { ...action, ok: false, skipped: 'torrkörning' };
  else {
    try {
      const [cur] = await ctx.supabase.rpc('meta_token_get', { p_user_id: row.user_id });
      await ctx.supabase.rpc('meta_token_put', { p_user_id: row.user_id, p_token: cur.access_token, p_expires_at: cur.expires_at, p_meta_user_id: cur.meta_user_id }, { write: true });
      result.action = { ...action, ok: true, after: { encrypted: true } };
    } catch (e) {
      result.action = { ...action, ok: false, error: e.message };
    }
  }
  result.human = !result.action.ok;
  return result;
}

// Läser driftsatt Admiral token via Vault? (Modul D: /api/write-settings finns.) Annars skulle ett
// krypterat token se tomt ut för den gamla koden, som läser meta_tokens.access_token direkt.
export async function vaultCodeLive(ctx) {
  if (ctx._vaultLive === undefined) {
    const r = await ctx.admiral.api('/api/write-settings');
    ctx._vaultLive = r.status === 401 || r.status === 200;
  }
  return ctx._vaultLive;
}

async function renewToken(ctx, row, who, state) {
  const { meta, supabase } = ctx;
  const action = { kind: 'token-renewal', description: `Förnya Meta-token för ${who}`, before: { expires_at: state.exp?.toISOString() ?? null } };
  try {
    const res = await meta.exchangeToken(state.token);
    if (!res.access_token) throw new Error('Meta returnerade inget token');
    const d = await meta.debugToken(res.access_token);
    const newExp = d.expires_at ? new Date(d.expires_at * 1000) : null;
    if (!d.is_valid) throw new Error('nytt token är ogiltigt');
    if (!(d.scopes || []).includes('ads_read')) throw new Error('nytt token saknar ads_read');
    if (!newExp || newExp - state.exp < 86400000) throw new Error('Meta förlängde inte giltighetstiden; ny inloggning krävs');

    // Föregående tillstånd sparas lokalt (chmod 600) så att bytet kan backas.
    const rollbackFile = saveRollback(ctx, `meta-token-user-${row.user_id}`, { table: 'meta_tokens', id: row.id, access_token: state.token, expires_at: state.dbExpires });
    if (await vaultCodeLive(ctx)) {
      await supabase.rpc('meta_token_put', {
        p_user_id: row.user_id, p_token: res.access_token, p_expires_at: newExp.toISOString(), p_meta_user_id: row.meta_user_id ?? null,
      }, { write: true });
    } else {
      await supabase.patch('meta_tokens', `id=eq.${row.id}`, { access_token: res.access_token, expires_at: newExp.toISOString(), updated_at: new Date().toISOString() });
    }
    return { ...action, ok: true, after: { expires_at: newExp.toISOString() }, rollback: rollbackFile };
  } catch (e) {
    return { ...action, ok: false, error: e.message };
  }
}

export function saveRollback(ctx, name, data) {
  const dir = path.join(ctx.config.stateDir, 'rollback');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${ctx.runId}-${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ saved_at: new Date().toISOString(), ...data }, null, 2), { mode: 0o600 });
  return file;
}

async function checkNetlify(ctx) {
  const { config, meta } = ctx;
  if (!config.netlify.token) {
    return [skip(A, 'infra.netlify', 'NETLIFY_AUTH_TOKEN saknas i modulens konfiguration — deploy- och env-kontroller kördes inte')];
  }
  const out = [];
  const nf = (p) => fetchJson(`https://api.netlify.com/api/v1${p}`, { headers: { Authorization: `Bearer ${config.netlify.token}` } });

  const site = await nf(`/sites/${config.netlify.siteId}`);
  if (!site.ok) return [fail(A, 'infra.netlify site', `Netlify API svarade HTTP ${site.status || site.error}`, { where: 'Netlify API' })];

  // Publicerad deploy
  const deployId = site.json.published_deploy?.id || site.json.deploy_id;
  const deploy = deployId ? await nf(`/deploys/${deployId}`) : { ok: false };
  {
    const id = 'infra.netlify deploy';
    if (!deploy.ok || deploy.json?.state !== 'ready') {
      out.push(fail(A, id, `Publicerad deploy är inte i läge ready (${deploy.json?.state || deploy.status})`, { where: `Netlify ${site.json.name}` }));
    } else out.push(pass(A, id));
  }
  // Schemalagda funktioner
  if (deploy.ok) {
    const schedules = Object.fromEntries((deploy.json.function_schedules || []).map((s) => [s.name, s.cron]));
    for (const [fn, cron] of Object.entries(EXPECTED_SCHEDULES)) {
      const id = `infra.netlify schedule ${fn}`;
      if (schedules[fn] !== cron) out.push(fail(A, id, `Schemat för ${fn} är ${schedules[fn] || 'borta'}, förväntat ${cron}`, { where: 'netlify.toml [functions]' }));
      else out.push(pass(A, id));
    }
  }

  // Miljövariabler (produktion)
  const accountId = site.json.account_id;
  const envRes = await nf(`/accounts/${accountId}/env?site_id=${config.netlify.siteId}`);
  if (!envRes.ok) {
    out.push(fail(A, 'infra.netlify env', `Kunde inte läsa miljövariabler (HTTP ${envRes.status || envRes.error})`, { where: 'Netlify API' }));
    return out;
  }
  const prodValue = (key) => {
    const e = envRes.json.find((x) => x.key === key);
    if (!e) return null;
    const v = (e.values || []).find((x) => x.context === 'production') || (e.values || []).find((x) => x.context === 'all');
    return v?.value ?? null;
  };
  for (const key of REQUIRED_NETLIFY_ENV) {
    const id = `infra.env ${key}`;
    const value = prodValue(key);
    const scopes = envRes.json.find((x) => x.key === key)?.scopes || [];
    if (value === null || value === '') {
      out.push(fail(A, id, `Miljövariabeln ${key} saknas i Netlify (produktion)`, { where: envUsage(key) }));
    } else if (!scopes.includes('functions')) {
      out.push(fail(A, id, `Miljövariabeln ${key} är inte tillgänglig för Functions (scope: ${scopes.join(', ') || 'inget'})`, { where: envUsage(key) }));
    } else out.push(pass(A, id));
  }
  // META_ACCESS_TOKEN används av budget-activate — måste vara giltigt.
  const envToken = prodValue('META_ACCESS_TOKEN');
  if (envToken) {
    const id = 'infra.env META_ACCESS_TOKEN giltighet';
    try {
      const d = await meta.debugToken(envToken);
      if (!d.is_valid) out.push(fail(A, id, 'Meta-tokenet i miljövariabeln META_ACCESS_TOKEN är ogiltigt', { where: 'netlify/functions/budget-activate.js (process.env.META_ACCESS_TOKEN)' }));
      else out.push(pass(A, id));
    } catch (e) {
      out.push(fail(A, id, `Kunde inte kontrollera META_ACCESS_TOKEN: ${e.message}`, { where: 'Netlify env' }));
    }
  }
  return out;
}

function envUsage(key) {
  return {
    RESEND_API_KEY: 'netlify/functions/lib/send-email.js (dagliga rapporter och token-varningar skickas inte)',
    META_ACCESS_TOKEN: 'netlify/functions/budget-activate.js',
    GA4_PROPERTY_ID: 'netlify/functions/ga4-insights.js',
    GA4_SERVICE_ACCOUNT_JSON: 'netlify/functions/ga4-insights.js',
  }[key] || 'Netlify env (produktion)';
}
