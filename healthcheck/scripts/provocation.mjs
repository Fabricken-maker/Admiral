#!/usr/bin/env node
// Provokationstest (definition of done). Kör mot en verklig kund:
//   node scripts/provocation.mjs --account=<act_id> --plan=<budget_plan_id> --date=<YYYY-MM-DD>
//
// A. Genomströmmad siffra: kontots spend förvrängs +5 % i minnet (ingen skrivning).
//    Förväntat: avvikelsen fångas med kund/konto/mått/värden/diff och rapporteras som
//    "kräver människa" (felet skulle sitta i kod, som modulen inte rör).
// B. Lagrad siffra: planens spend_log-rad för --date (en budget-adjust-rad äldre än 3 dygn)
//    får ett felaktigt värde. Förväntat: avvikelsen fångas, raden synkas om från Meta,
//    verifieraren bekräftar. Därefter återställs radens ursprungliga värden exakt.
import assert from 'node:assert/strict';
import { loadDotEnv, buildConfig } from '../src/config.js';
import { runHealthcheck } from '../src/orchestrator.js';
import { createSupabase } from '../src/lib/supabase.js';

loadDotEnv();
const config = buildConfig();
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const ACCOUNT = args.account;
const PLAN_ID = Number(args.plan);
const LOG_DATE = args.date;
if (!ACCOUNT || !PLAN_ID || !/^\d{4}-\d{2}-\d{2}$/.test(LOG_DATE || '')) {
  console.error('Användning: node scripts/provocation.mjs --account=<act_id> --plan=<budget_plan_id> --date=<YYYY-MM-DD>');
  process.exit(1);
}
const MONTH = LOG_DATE.slice(0, 7);
const monthEnd = new Date(Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 0)).toISOString().slice(0, 10);

const sb = createSupabase({ url: config.supabaseUrl, key: config.supabaseKey });

// ── A ──
console.log('A. Förvrängd genomströmmad siffra (i minnet)');
const a = await runHealthcheck(config, {
  trigger: 'test', only: ['data'], noNotify: true,
  options: { inject: { level: 'konto', id: ACCOUNT, metric: 'spend', factor: 1.05 }, storedFrom: '2000-01-01', storedTo: '2000-01-01' },
});
const aIssue = a.issues.find((i) => i.id === 'data.admin.konto.spend');
assert.ok(aIssue, 'avvikelsen på kontots spend fångades inte');
const aDev = aIssue.deviations.find((d) => d.account.includes(ACCOUNT));
assert.ok(aDev && aDev.diff > 0 && aDev.admiral > aDev.source, 'avvikelsen saknar korrekta värden');
assert.equal(aIssue.human, true);
assert.equal(a.status, 'RÖD');
console.log(a.report.split('\n').filter((l) => new RegExp(`${ACCOUNT}|kontonivå|RÖD|Plats`).test(l)).join('\n'));
console.log('  ✓ fångad och rapporterad som "kräver människa"\n');

// ── B ──
console.log('B. Felaktigt lagrat värde i spend_log (återställs efteråt)');
const [original] = await sb.select('spend_log', `select=id,actual_spend,pacing_ratio,real_roas&budget_plan_id=eq.${PLAN_ID}&log_date=eq.${LOG_DATE}`);
assert.ok(original, `spend_log-raden för plan ${PLAN_ID} ${LOG_DATE} saknas`);
console.log(`  originalvärden: actual_spend ${original.actual_spend}, pacing_ratio ${original.pacing_ratio}, real_roas ${original.real_roas}`);
const injected = Number(original.actual_spend) + 500;

try {
  await sb.patch('spend_log', `id=eq.${original.id}`, { actual_spend: injected });
  console.log(`  infört fel: actual_spend ${injected}`);

  const b = await runHealthcheck(config, {
    trigger: 'test', only: ['data'], noNotify: true,
    options: { storedFrom: `${MONTH}-01`, storedTo: monthEnd, planId: PLAN_ID },
  });
  const bIssue = b.issues.find((i) => i.id === `data.spend_log ${original.id}`);
  assert.ok(bIssue, 'det införda felet fångades inte');
  assert.equal(bIssue.action?.ok, true, `reparationen misslyckades: ${bIssue.action?.error}`);
  assert.equal(bIssue.verified, true, 'verifieraren bekräftade inte reparationen');
  const others = b.issues.filter((i) => i.id.startsWith('data.spend_log') && i.id !== bIssue.id);
  assert.deepEqual(others.map((i) => i.id), [], 'andra spend_log-rader flaggades felaktigt');
  console.log(b.report.split('\n').filter((l) => /spend_log|Åtgärd|Verifierad|GUL|RÖD/.test(l)).join('\n'));
  console.log('  ✓ fångad, reparerad och verifierad');
} finally {
  await sb.patch('spend_log', `id=eq.${original.id}`, {
    actual_spend: original.actual_spend, pacing_ratio: original.pacing_ratio, real_roas: original.real_roas,
  });
  const [after] = await sb.select('spend_log', `select=actual_spend,pacing_ratio,real_roas&id=eq.${original.id}`);
  const same = Number(after.actual_spend) === Number(original.actual_spend)
    && Number(after.pacing_ratio) === Number(original.pacing_ratio)
    && Number(after.real_roas) === Number(original.real_roas);
  console.log(`  återställt: actual_spend ${after.actual_spend}, pacing_ratio ${after.pacing_ratio}, real_roas ${after.real_roas} ${same ? '✓' : '✗ AVVIKER'}`);
  if (!same) process.exitCode = 1;
}
