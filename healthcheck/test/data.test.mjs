import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffView, writtenByBudgetAdjust } from '../src/agents/data.js';
import { canonicalInsight } from '../src/lib/metrics.js';

const config = { tolerance: { relative: 0.01, absoluteFloor: 0.01 } };
const view = { label: 'admin', allowedAccounts: null };

function source() {
  const raw = { spend: '1234.56', impressions: '45678', clicks: '1500', cpm: '27.03', actions: [] };
  const campRaw = {
    spend: '987.65', impressions: '40000', clicks: '2000',
    actions: [{ action_type: 'landing_page_view', value: '900' }, { action_type: 'omni_landing_page_view', value: '900' }, { action_type: 'purchase', value: '2' }, { action_type: 'omni_purchase', value: '2' }],
    action_values: [{ action_type: 'purchase', value: '900' }, { action_type: 'omni_purchase', value: '900' }],
  };
  return {
    accounts: [{
      id: 'act_1', name: 'Konto A', insight: canonicalInsight(raw), rawActions: [],
      campaigns: [{ id: 'c1', name: 'Kampanj_A', status: 'PAUSED' }],
      campaignInsights: new Map([['c1', { ...canonicalInsight(campRaw), rawActions: campRaw.actions, rawValues: campRaw.action_values }]]),
    }],
  };
}
const admiralOk = () => ({
  accRes: { status: 200, json: { accounts: [{ id: 'act_1', name: 'Konto A', spend: 1234.56, impressions: 45678, clicks: 1500, cpm: 27.03, conversions: 0 }] } },
  campRes: { status: 200, json: { campaigns: [{ id: 'c1', name: 'Kampanj_A', ad_account_id: 'act_1', spend: 987.65, impressions: 40000, clicks: 2000, conversions: 2, revenue: 900, roas: 900 / 987.65, link_clicks: 0, landing_page_views: 900 }] } },
});

test('identiska siffror ger inga avvikelser', () => {
  assert.deepEqual(diffView({ config }, view, { ...admiralOk(), source: source() }), []);
});

test('medvetet införd avvikelse (provokation) fångas med kund, kampanj, mått, värden och diff', () => {
  const ctx = { config, options: { inject: { level: 'kampanj', id: 'c1', metric: 'spend', factor: 1.05 } } };
  const devs = diffView(ctx, view, { ...admiralOk(), source: source() });
  assert.equal(devs.length, 1);
  assert.equal(devs[0].metric, 'spend');
  assert.equal(devs[0].campaign, 'Kampanj_A (c1)');
  assert.equal(devs[0].customer, 'admin');
  assert.equal(devs[0].source, 987.65);
  assert.ok(Math.abs(devs[0].diff - 49.38) < 0.01);
});

test('summerade köp-typer identifieras som orsak', () => {
  const adm = admiralOk();
  adm.campRes.json.campaigns[0].conversions = 4; // purchase + omni_purchase
  adm.campRes.json.campaigns[0].revenue = 1800;
  adm.campRes.json.campaigns[0].roas = 1800 / 987.65;
  const devs = diffView({ config }, view, { ...adm, source: source() });
  const conv = devs.find((d) => d.metric === 'conversions');
  assert.equal(conv.cause, 'summerade köp-typer');
  assert.equal(devs.find((d) => d.metric === 'revenue').cause, 'summerade köp-typer');
});

test('saknade kampanjer och konton fångas', () => {
  const adm = admiralOk();
  adm.campRes.json.campaigns = [];
  adm.accRes.json.accounts = [];
  const devs = diffView({ config }, view, { ...adm, source: source() });
  assert.ok(devs.some((d) => d.metric === 'antal kampanjer' && d.admiral === 0 && d.source === 1));
  assert.ok(devs.some((d) => d.metric === 'konto saknas i Admiral'));
});

test('bara rader som budget-adjust själv skrivit stäms av', () => {
  assert.equal(writtenByBudgetAdjust({ log_date: '2026-06-03', created_at: '2026-06-03 06:08:01.203488' }), true);
  assert.equal(writtenByBudgetAdjust({ log_date: '2026-05-18', created_at: '2026-05-20 00:06:51.863592' }), false);
  assert.equal(writtenByBudgetAdjust({ log_date: '2026-05-31', created_at: '2026-05-31 21:18:03.037866' }), false);
});
