#!/usr/bin/env node
// Admiral Weekly Health Check — körning.
//   node bin/run.mjs --trigger=scheduled            (cron, en gång per vecka)
//   node bin/run.mjs --trigger=manual [--dry-run]   (manuell test)
// Flaggor: --only=infra,data,ui,jobs  --no-persist  --no-notify  --force
//          --stored-from=YYYY-MM-DD --stored-to=YYYY-MM-DD --plan=<budget_plan_id>
//          --inject=<konto|kampanj>:<id>:<mått>:<faktor>   (provokationstest, bara i minnet)
// Avslutas med kod 0 när körningen fullföljts (oavsett GRÖN/GUL/RÖD), 1 om modulen kraschar.
import { loadDotEnv, buildConfig } from '../src/config.js';
import { runHealthcheck } from '../src/orchestrator.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));

loadDotEnv();
const config = buildConfig();
const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET', 'META_APP_ID', 'META_APP_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Konfiguration saknas: ${missing.join(', ')}`);
  process.exit(1);
}

const options = {};
if (args['stored-from']) options.storedFrom = args['stored-from'];
if (args['stored-to']) options.storedTo = args['stored-to'];
if (args.plan) options.planId = Number(args.plan);
if (args.inject) {
  const [level, id, metric, factor] = String(args.inject).split(':');
  options.inject = { level, id, metric, factor: Number(factor) };
}

const started = Date.now();
try {
  const res = await runHealthcheck(config, {
    trigger: args.trigger || 'manual',
    dryRun: !!args['dry-run'],
    only: args.only ? String(args.only).split(',') : null,
    noPersist: !!args['no-persist'],
    noNotify: !!args['no-notify'],
    force: !!args.force,
    options,
  });
  if (res.skipped) {
    console.log(`Redan körd denna vecka (${res.runKey}, ${res.status}) — inget gjort.`);
    process.exit(0);
  }
  // Loggen innehåller bara rapporten (samma som i Telegram) och tekniska fakta.
  console.log(res.report);
  console.log(`\n[run ${res.row.run_id}] ${Math.round((Date.now() - started) / 1000)} s, sparad: ${args['no-persist'] ? 'nej (--no-persist)' : res.persisted.ok ? 'ja' : `NEJ (${res.persisted.error})`}, notis: ${res.notified.ok ? 'ja' : `nej (${res.notified.error})`}`);
  if (args.json) console.log(JSON.stringify({ issues: res.row.deviations, actions: res.row.actions, metrics: res.row.metrics }, null, 2));
  process.exit(res.persisted.ok || args['no-persist'] ? 0 : 1);
} catch (e) {
  console.error(`Modulen kraschade: ${e.stack || e.message}`);
  process.exit(1);
}
