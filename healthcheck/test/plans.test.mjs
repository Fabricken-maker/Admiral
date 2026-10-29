import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plansMissing, checkPlanCoverage } from '../src/agents/jobs-plans.js';

const m = (campaign_id, spend, campaign_name = campaign_id) => ({ campaign_id, campaign_name, spend });

test('kampanj med spend utan plan larmas; aktiv plan täcker; utan spend ignoreras', () => {
  const metrics = [m('tb', '1233.11', 'TB_Trafik_2026H2'), m('tackt', '500'), m('vilande', '0')];
  const plans = [{ campaign_id: 'tackt', status: 'active' }];
  assert.deepEqual(plansMissing({ metrics, plans }).map((x) => [x.campaign_id, x.plan_status]), [['tb', null]]);
});

test('pausad eller avslutad plan räknas inte som täckning, men nämns i larmet', () => {
  const metrics = [m('a', '100'), m('b', '100')];
  const plans = [
    { campaign_id: 'a', status: 'completed' },
    { campaign_id: 'b', status: 'paused' },
    { campaign_id: 'b', status: 'completed' }, // gammal månad — aktivaste status vinner
  ];
  assert.deepEqual(plansMissing({ metrics, plans }).map((x) => [x.campaign_id, x.plan_status]), [['a', 'completed'], ['b', 'paused']]);
  assert.equal(plansMissing({ metrics: [m('b', '100')], plans: [...plans, { campaign_id: 'b', status: 'active' }] }).length, 0);
});

function fakeCtx(rowsByTable) {
  return {
    supabase: {
      async select(table, query) {
        return rowsByTable[table]?.(query) ?? [];
      },
    },
  };
}

test('checkPlanCoverage: Daniel-fallet — TB_Trafik spenderar men bara AimPoint (completed) finns', async () => {
  const ctx = fakeCtx({
    weekly_settings: () => [{ user_id: 6, ad_account_ids: ['act_1'], users: { email: 'daniel@dbgolf.se', company_name: 'DB Golf', status: 'active' } }],
    weekly_metrics: () => [m('120253569145470422', '1233.11', 'TB_Trafik_2026H2')],
    budget_plans: () => [{ campaign_id: '120247548072170422', status: 'completed' }],
  });
  const out = await checkPlanCoverage(ctx, '2026-10-19');
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, false);
  assert.match(out[0].cause, /TB_Trafik_2026H2/);
  assert.match(out[0].cause, /ingen plan alls/);
  assert.match(out[0].where, /campaign-discovery/);
  // recheck: när planen har skapats blir kontrollen grön
  ctx.supabase.select = async (table) => (table === 'weekly_settings' ? []
    : table === 'weekly_metrics' ? [m('120253569145470422', '1233.11', 'TB_Trafik_2026H2')]
      : [{ campaign_id: '120253569145470422', status: 'active' }]);
  assert.deepEqual(await out[0].recheck(), { ok: true });
});

test('checkPlanCoverage: allt täckt ger pass per konto, pausade användare hoppas över', async () => {
  const ctx = fakeCtx({
    weekly_settings: () => [
      { user_id: 6, ad_account_ids: ['act_1'], users: { email: 'daniel@dbgolf.se', company_name: 'DB Golf', status: 'active' } },
      { user_id: 9, ad_account_ids: ['act_9'], users: { email: 'x@y.se', company_name: null, status: 'paused' } },
    ],
    weekly_metrics: () => [m('tb', '900')],
    budget_plans: () => [{ campaign_id: 'tb', status: 'active' }],
  });
  const out = await checkPlanCoverage(ctx, '2026-10-19');
  assert.deepEqual(out.map((r) => [r.id, r.ok]), [['jobs.kampanjplan DB Golf act_1', true]]);
});
