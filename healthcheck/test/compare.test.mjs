import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareAmount, compareInt, compareMetrics, bracketCheck } from '../src/lib/compare.js';
import { canonicalInsight } from '../src/lib/metrics.js';

const tol = { relative: 0.01, absoluteFloor: 0.01 };

test('belopp: ±1 % ok, utanför inte', () => {
  assert.equal(compareAmount(1009.99, 1000, tol).ok, true);
  assert.equal(compareAmount(990.01, 1000, tol).ok, true);
  assert.equal(compareAmount(1010.5, 1000, tol).ok, false);
  assert.equal(compareAmount(0, 0, tol).ok, true);
  assert.equal(compareAmount(0.02, 0, tol).ok, false);
});

test('heltal: exakt', () => {
  assert.equal(compareInt(1792, 1792).ok, true);
  assert.equal(compareInt(1793, 1792).ok, false);
});

test('compareMetrics returnerar avvikelse med kund, kampanj, mått, värden och diff', () => {
  const d = compareMetrics({ customer: 'Kund A', campaign: 'Kampanj A (1)' },
    { spend: 1234.56, clicks: 1508, cpm: 27.0 }, { spend: 1234.56, clicks: 1500, cpm: 27.03 },
    { spend: 'amount', clicks: 'int', cpm: 'amount', reach: 'int' }, tol);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { customer: 'Kund A', account: null, campaign: 'Kampanj A (1)', metric: 'clicks', admiral: 1508, source: 1500, diff: 8 });
});

test('mått som Admiral inte visar jämförs inte', () => {
  assert.equal(compareMetrics({}, { spend: 1 }, { spend: 1, reach: 99 }, { spend: 'amount', reach: 'int' }, tol).length, 0);
});

test('spend_log-intervall: kumulativ 06:00-ögonblicksbild ska ligga mellan föregående och aktuellt dygn', () => {
  // Daglig spend: 1 jun 100.00, 2 jun 150.00, 3 jun 120.00
  assert.equal(bracketCheck(130.00, 100.00, 250.00, tol).ok, true);
  assert.equal(bracketCheck(290.00, 250.00, 370.00, tol).ok, true);
  assert.equal(bracketCheck(790.00, 250.00, 370.00, tol).ok, false);
  assert.equal(bracketCheck(60, 100.00, 250.00, tol).ok, false);
});

test('köp räknas som Meta gör: största av överlappande action_types, inte summan', () => {
  const row = {
    spend: '100', impressions: '1000', clicks: '10',
    actions: [{ action_type: 'purchase', value: '3' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }, { action_type: 'link_click', value: '8' }],
    action_values: [{ action_type: 'purchase', value: '450' }, { action_type: 'omni_purchase', value: '450' }],
  };
  const c = canonicalInsight(row);
  assert.equal(c.conversions, 3);
  assert.equal(c.revenue, 450);
  assert.equal(c.roas, 4.5);
  assert.equal(c.link_clicks, 8);
  assert.equal(c.cpm, 100);
});
