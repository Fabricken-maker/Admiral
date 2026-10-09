#!/usr/bin/env node
// Vakthund: larmar om ingen schemalagd veckokontroll har sparats på 8 dygn
// (cron borta, VPS-omstart, modulen tyst). Körs dagligen från cron.
import { loadDotEnv, buildConfig } from '../src/config.js';
import { installGuard } from '../src/lib/guard.js';
import { createSupabase } from '../src/lib/supabase.js';
import { sendTelegram } from '../src/lib/telegram.js';

loadDotEnv();
const config = buildConfig();
installGuard({ baseUrl: config.baseUrl, supabaseUrl: config.supabaseUrl });
const sb = createSupabase({ url: config.supabaseUrl, key: config.supabaseKey });

const MAX_AGE_DAYS = 8;
try {
  const [last] = await sb.select('admiral_healthchecks', 'select=started_at,status&trigger=eq.scheduled&order=started_at.desc&limit=1');
  // Före första schemalagda körningen räknas åldern från modulens första sparade körning.
  const [first] = last ? [] : await sb.select('admiral_healthchecks', 'select=started_at&order=started_at.asc&limit=1');
  const since = last?.started_at || first?.started_at;
  const ageDays = since ? (Date.now() - new Date(since)) / 86400000 : Infinity;
  if (ageDays > MAX_AGE_DAYS) {
    const text = last
      ? `⚠️ Admiral veckokontroll har inte körts sedan ${last.started_at.slice(0, 10)} (${Math.floor(ageDays)} dygn).`
      : '⚠️ Admiral veckokontroll har aldrig sparat någon schemalagd körning.';
    const r = await sendTelegram(config.telegram, text);
    console.log(`${new Date().toISOString()} LARM ${text} (notis: ${r.ok ? 'ja' : r.error})`);
    process.exit(r.ok ? 0 : 1);
  }
  console.log(`${new Date().toISOString()} OK ${last ? `senaste schemalagda ${last.started_at} ${last.status}` : `ingen schemalagd körning ännu, första körning ${since}`}`);
} catch (e) {
  await sendTelegram(config.telegram, `⚠️ Admiral veckokontrollens vakthund kunde inte läsa admiral_healthchecks: ${e.message}`);
  console.error(e.message);
  process.exit(1);
}
