// Agent 3 — Grafik & UI.
// Renderar dashboarden i headless Chrome som admin och jämför KPI-kort, kampanjtabell
// och Chart.js-datapunkter mot de API-svar sidan själv fick (som agent 2 i sin tur
// stämmer av mot Meta). Fångar konsolfel, trasiga laddningar, tomma värden och
// hårdkodad data där riktig data finns. Sidan får inte skriva: alla anrop som inte är
// GET avbryts i webbläsaren innan de lämnar den.
// Inga automatiska reparationer: allt som hittas här sitter i dashboard.html.
import puppeteer from 'puppeteer-core';
import { pass, fail, skip } from '../lib/result.js';

const A = 'ui';
const FILE = 'public/dashboard.html';

export async function run(ctx) {
  const { config, admiral } = ctx;
  if (!config.browser.wsEndpoint && !config.browser.chromePath) {
    return [skip(A, 'ui.browser', 'Ingen webbläsare konfigurerad (BROWSER_WS_ENDPOINT eller CHROME_PATH)')];
  }
  const admin = await ctx.getAdminUser();
  if (!admin) return [fail(A, 'ui.admin', 'Admin-kontot saknas — dashboarden kunde inte renderas', { where: 'Supabase users' })];

  const snapshot = await renderDashboard(ctx, admin);
  const html = (await admiral.api('/dashboard.html')).text || '';
  const where = (needle, label) => {
    const idx = html.indexOf(needle);
    const line = idx >= 0 ? html.slice(0, idx).split('\n').length : null;
    return `${FILE}${line ? `:${line}` : ''}${label ? ` (${label})` : ''}`;
  };
  return evaluate(snapshot, where);
}

async function renderDashboard(ctx, admin) {
  const { config, admiral } = ctx;
  const browser = config.browser.wsEndpoint
    ? await puppeteer.connect({ browserWSEndpoint: config.browser.wsEndpoint })
    : await puppeteer.launch({ executablePath: config.browser.chromePath, headless: true, args: ['--no-sandbox'] });

  const snap = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], blockedWrites: [], api: {} };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const m = req.method();
      if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
        // Allt som inte är läsning stoppas; bara Admirals egna anrop räknas som fel.
        if (isAppRequest(req.url(), config.baseUrl)) snap.blockedWrites.push(`${m} ${new URL(req.url()).pathname}`);
        return req.abort('blockedbyclient');
      }
      return req.continue();
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const src = msg.location()?.url;
      if (src && !isAppRequest(src, config.baseUrl)) return;
      snap.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => snap.pageErrors.push(String(err.message || err).slice(0, 300)));
    page.on('requestfailed', (req) => {
      const reason = req.failure()?.errorText || '';
      if (reason.includes('BLOCKED_BY_CLIENT') || !isAppRequest(req.url(), config.baseUrl)) return;
      snap.failedRequests.push(`${req.method()} ${shortUrl(req.url())} — ${reason}`);
    });
    page.on('response', async (res) => {
      const url = new URL(res.url());
      if (res.status() >= 400 && isAppRequest(res.url(), config.baseUrl)) snap.badResponses.push(`${res.status()} ${shortUrl(res.url())}`);
      if (url.origin === config.baseUrl && url.pathname.startsWith('/api/') && res.request().method() === 'GET') {
        try { snap.api[url.pathname + url.search] = await res.json(); } catch { /* inte JSON */ }
      }
    });

    const jwt = admiral.tokenFor(admin);
    await page.evaluateOnNewDocument((token, user) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    }, jwt, { id: admin.id, email: admin.email });

    await page.goto(`${config.baseUrl}/dashboard.html`, { waitUntil: 'networkidle0', timeout: 90_000 });
    await new Promise((r) => setTimeout(r, 1500)); // låt Chart.js-animationer och sena fetch-kedjor landa

    snap.dom = await page.evaluate(() => {
      const text = (id) => document.getElementById(id)?.textContent.trim() ?? null;
      const visible = (id) => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
      const chart = (id) => {
        const c = window.Chart?.getChart?.(id);
        return c ? { labels: [...c.data.labels], datasets: c.data.datasets.map((d) => ({ label: d.label ?? null, data: [...d.data] })) } : null;
      };
      return {
        url: location.pathname,
        kpi: {
          spend: text('kpi-spend'), impressions: text('kpi-impressions'), clicks: text('kpi-clicks'),
          conversions: text('kpi-conversions'), roas: text('kpi-roas'),
        },
        campaigns: [...document.querySelectorAll('#camp-tbody tr')].map((tr) => {
          const td = tr.querySelectorAll('td');
          return { name: tr.querySelector('.nm')?.textContent.trim() ?? null, spend: td[2]?.textContent.trim() ?? null, cells: td.length };
        }),
        charts: { spendChart: chart('spendChart'), bokaChart: chart('bokaChart'), audChart: chart('audChart') },
        timelinePlaceholder: visible('tl-placeholder-banner'),
      };
    });

    // Sökpanelen och notispanelen öppnas utan att något skickas.
    snap.search = await page.evaluate(async () => {
      if (typeof openSearch !== 'function') return null;
      openSearch();
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll('#search-results .search-result-row')].map((r) => ({
        label: r.querySelector(':scope > div > div:first-child')?.textContent.trim(),
        type: r.lastElementChild?.textContent.trim(),
      }));
      closeSearch();
      return rows;
    });
    snap.notifs = await page.evaluate(async () => {
      if (typeof toggleNotif !== 'function') return null;
      toggleNotif();
      for (let i = 0; i < 40 && !notifLoaded; i++) await new Promise((r) => setTimeout(r, 250));
      const placeholder = Array.isArray(notifData) && notifData.length > 0 && !!notifData[0]._placeholder;
      return { placeholder, count: Array.isArray(notifData) ? notifData.length : 0 };
    });
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    if (config.browser.wsEndpoint) await browser.disconnect(); else await browser.close();
  }
  return snap;
}

const shortUrl = (u) => {
  try { const x = new URL(u); const p = x.pathname.length > 60 ? `${x.pathname.slice(0, 57)}…` : x.pathname; return x.host + p; } catch { return u; }
};

// Admirals egna anrop: API, auth, funktioner och statiska filer (även CDN som Chart.js).
// Netlify injicerar egna skript på slumpade sökvägar; de är inte Admirals kod.
export function isAppRequest(rawUrl, baseUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
  const sameOrigin = u.origin === new URL(baseUrl).origin;
  if (!sameOrigin) return /\.(js|css|woff2?|png|svg|jpe?g)$/.test(u.pathname);
  return u.pathname === '/' || /^\/(api|auth|\.netlify)\//.test(u.pathname) || /\.[a-z0-9]{2,5}$/i.test(u.pathname);
}

// Tolkar "3 474 kr", "67K", "1.2M", "4,73×", "—".
export function parseDisplayed(text) {
  if (text === null || text === undefined) return { value: null };
  const t = String(text).replace(/ | /g, ' ').trim();
  if (t === '—' || t === '' || t === '-') return { value: null };
  const m = t.match(/(-?[\d\s]+(?:[.,]\d+)?)\s*([KM])?/);
  if (!m) return { value: null };
  const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  if (m[2] === 'K') return { value: n * 1000, precision: 500 };
  if (m[2] === 'M') return { value: n * 1_000_000, precision: 50_000 };
  const decimals = (m[1].split(/[.,]/)[1] || '').length;
  return { value: n, precision: decimals ? 0.5 * 10 ** -decimals : 0.5 };
}

function sameNumber(displayed, expected) {
  const p = parseDisplayed(displayed);
  if (p.value === null) return expected === 0 || expected === null;
  return Math.abs(p.value - expected) <= p.precision + 1e-9;
}

export function evaluate(snap, where) {
  const out = [];
  const api = snap.api;
  const find = (prefix) => Object.entries(api).find(([k]) => k.startsWith(prefix))?.[1];
  const accounts = find('/api/meta/accounts')?.accounts;
  const campaigns = find('/api/meta/campaigns')?.campaigns;
  const timeline = find('/api/timeline');
  const conversions = find('/api/conversions?') ?? api['/api/conversions'];
  const ga4 = find('/api/ga4/insights');
  const dom = snap.dom || {};

  // ── Sidladdning ──
  if (dom.url && dom.url !== '/dashboard.html') {
    out.push(fail(A, 'ui.load', `Dashboarden omdirigerade till ${dom.url} med giltig admin-session`, { where: where("window.location.href = '/'") }));
    return out;
  }
  out.push(snap.pageErrors.length
    ? fail(A, 'ui.js-fel', `JavaScript-fel på dashboarden: ${uniq(snap.pageErrors).slice(0, 3).join(' | ')}`, { where: FILE })
    : pass(A, 'ui.js-fel'));
  const consoleErrs = uniq(snap.consoleErrors).filter((e) => !/Failed to load resource/.test(e));
  out.push(consoleErrs.length
    ? fail(A, 'ui.konsol', `Konsolfel på dashboarden (${consoleErrs.length}): ${consoleErrs.slice(0, 3).join(' | ')}`, { where: FILE })
    : pass(A, 'ui.konsol'));
  const broken = uniq([...snap.failedRequests, ...snap.badResponses]);
  out.push(broken.length
    ? fail(A, 'ui.laddning', `Trasiga laddningar (${broken.length}): ${broken.slice(0, 4).join(', ')}`, { where: FILE })
    : pass(A, 'ui.laddning'));
  out.push(snap.blockedWrites.length
    ? fail(A, 'ui.skrivning-vid-laddning', `Dashboarden försökte skriva vid sidladdning: ${uniq(snap.blockedWrites).join(', ')}`, { where: FILE })
    : pass(A, 'ui.skrivning-vid-laddning'));

  // ── KPI-kort mot /api/meta/accounts och /api/conversions ──
  if (accounts) {
    const sum = (k) => accounts.reduce((s, a) => s + (Number(a[k]) || 0), 0);
    const expected = { spend: sum('spend'), impressions: sum('impressions'), clicks: sum('clicks'), conversions: sum('conversions') };
    for (const [k, v] of Object.entries(expected)) {
      const id = `ui.kpi ${k}`;
      const shown = dom.kpi?.[k];
      if (sameNumber(shown, v)) { out.push(pass(A, id)); continue; }
      const empty = parseDisplayed(shown).value === null;
      out.push(fail(A, id, empty
        ? `KPI-kortet ${k} visar "${shown}" trots att källdatan är ${round2(v)}`
        : `KPI-kortet ${k} visar "${shown}", källdatan ger ${round2(v)}`, { where: where(`getElementById('kpi-${k}')`) }));
    }
    const revenue = Number(conversions?.totals?.revenue_sek || 0);
    const roas = expected.spend > 0 ? revenue / expected.spend : 0;
    const id = 'ui.kpi roas';
    out.push(sameNumber(dom.kpi?.roas, roas)
      ? pass(A, id)
      : fail(A, id, `KPI-kortet ROAS visar "${dom.kpi?.roas}", källdatan ger ${roas.toFixed(2)}×`, { where: where("getElementById('kpi-roas')") }));
  } else {
    out.push(fail(A, 'ui.kpi', 'Dashboarden hämtade aldrig /api/meta/accounts — KPI-korten saknar källa', { where: where('async function loadAccounts') }));
  }

  // ── Kampanjtabell mot /api/meta/campaigns ──
  if (campaigns) {
    const rows = (dom.campaigns || []).filter((r) => r.name);
    const expected = campaigns.slice(0, 10);
    const id = 'ui.kampanjtabell';
    const problems = [];
    if (rows.length !== expected.length) problems.push(`${rows.length} rader visas, källdatan har ${expected.length}`);
    expected.forEach((c, i) => {
      const r = rows[i];
      if (!r) return;
      if (r.name !== c.name) problems.push(`rad ${i + 1}: namn "${r.name}" ≠ "${c.name}"`);
      if (!sameNumber(r.spend, c.spend > 0 ? Math.round(c.spend) : 0)) problems.push(`rad ${i + 1} (${c.name}): spend "${r.spend}" ≠ ${Math.round(c.spend)} kr`);
    });
    out.push(problems.length
      ? fail(A, id, `Kampanjtabellen stämmer inte med källdatan: ${problems.slice(0, 4).join('; ')}`, { where: where('async function loadCampaigns') })
      : pass(A, id));
  }

  // ── Diagram ──
  if (timeline) {
    const id = 'ui.diagram spend';
    const window = expectedSpendWindow(timeline);
    const chart = dom.charts?.spendChart;
    if (!window.length) {
      out.push(chart && chart.datasets[0].data.some((v) => Number(v) !== 0)
        ? fail(A, id, 'Spend-diagrammet visar värden fast spend_log saknar data för perioden', { where: where('function buildSpendVsCourses') })
        : pass(A, id));
    } else if (!chart) {
      out.push(fail(A, id, `Spend-diagrammet renderades inte trots ${window.length} dagar spend-data`, { where: where('function buildSpendVsCourses') }));
    } else {
      const want = window.map((d) => [d.date.slice(5), Number(d.actual)]);
      const got = chart.labels.map((l, i) => [l, Number(chart.datasets[0].data[i])]);
      const mism = want.filter(([l, v], i) => !got[i] || got[i][0] !== l || got[i][1] !== v);
      out.push(mism.length || got.length !== want.length
        ? fail(A, id, `Spend-diagrammet avviker från /api/timeline på ${Math.max(mism.length, Math.abs(got.length - want.length))} datapunkter`, { where: where('function buildSpendVsCourses') })
        : pass(A, id));
    }
    const ph = 'ui.tidslinje platshållare';
    out.push(dom.timelinePlaceholder && (timeline.campaigns || []).length > 0
      ? fail(A, ph, `Tidslinjen visar exempeldata trots ${timeline.campaigns.length} riktiga kampanjer i /api/timeline`, { where: where('PLACEHOLDER_CAMPAIGNS') })
      : pass(A, ph));
  }
  if (ga4?.daily?.length) {
    const id = 'ui.diagram boka-klick';
    const chart = dom.charts?.bokaChart;
    const want = ga4.daily.map((d) => [d.date.slice(5), Number(d.boka_clicks)]);
    const got = chart ? chart.labels.map((l, i) => [l, Number(chart.datasets[0].data[i])]) : [];
    const ok = got.length === want.length && want.every(([l, v], i) => got[i][0] === l && got[i][1] === v);
    out.push(ok ? pass(A, id) : fail(A, id, 'Boka-klick-diagrammet avviker från /api/ga4/insights', { where: where('function buildBokaChart') }));
  }
  {
    // Diagram vars data inte kommer från något API är hårdkodade.
    const id = 'ui.diagram målgrupp';
    const aud = dom.charts?.audChart;
    out.push(aud
      ? fail(A, id, `Diagrammet Målgruppsfördelning visar fasta värden (${aud.datasets[0].data.join('/')}) som inte hämtas från någon datakälla`, { where: where("getElementById('audChart')") })
      : pass(A, id));
  }

  // ── Hårdkodad data i paneler ──
  if (snap.search && campaigns) {
    const id = 'ui.sök platshållare';
    const real = new Set(campaigns.map((c) => c.name));
    const fake = snap.search.filter((r) => r.type === 'Kampanj' && r.label && !real.has(r.label)).map((r) => r.label);
    out.push(fake.length
      ? fail(A, id, `Sökpanelen visar kampanjer som inte finns i datan: ${fake.slice(0, 3).join(', ')}`, { where: where('const PLACEHOLDER_SEARCH') })
      : pass(A, id));
  }
  if (snap.notifs) {
    const id = 'ui.notiser platshållare';
    const reports = find('/api/reports')?.reports || [];
    out.push(snap.notifs.placeholder && reports.length > 0
      ? fail(A, id, `Notispanelen visar exempeldata trots ${reports.length} riktiga rapporter i /api/reports`, { where: where('const PLACEHOLDER_NOTIFS') })
      : pass(A, id));
  }
  return out;
}

// Samma fönster som loadInsights(): tidigaste month_start bland tidslinjens kampanjer, annars 30 dagar.
export function expectedSpendWindow(timeline, now = new Date()) {
  let earliest = null;
  for (const c of timeline.campaigns || []) {
    if (c.month_start) { const d = new Date(c.month_start); if (!earliest || d < earliest) earliest = d; }
  }
  const fallback = new Date(now.getTime() - 30 * 86400000);
  const start = earliest && earliest < now ? earliest : fallback;
  const startStr = start.toISOString().slice(0, 10);
  return (timeline.daily_spend || []).filter((d) => d.date >= startStr);
}

const uniq = (a) => [...new Set(a)];
const round2 = (v) => Math.round(v * 100) / 100;
