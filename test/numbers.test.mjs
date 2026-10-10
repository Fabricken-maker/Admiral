import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateAge, MIN_IMPRESSIONS } from '../netlify/functions/lib/audience.js';
import { actionValue, PURCHASE_TYPES } from '../netlify/functions/lib/weekly.js';

const dir = new URL('../netlify/functions/', import.meta.url).pathname;
const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('målgrupp: andel visningar per åldersgrupp i åldersordning, flera konton summeras', () => {
  const r = aggregateAge([
    { age: '35-44', impressions: '300', spend: '30.5' },
    { age: '18-24', impressions: '100', spend: '10' },
    { age: '35-44', impressions: '100', spend: '9.5' },
    { age: '65+', impressions: '0', spend: '0' },
  ]);
  assert.equal(r.total_impressions, 500);
  assert.equal(r.enough, true);
  assert.deepEqual(r.groups.map((g) => [g.age, g.share, g.spend]), [['18-24', 0.2, 10], ['35-44', 0.8, 40]]);
  assert.equal(aggregateAge([{ age: '25-34', impressions: String(MIN_IMPRESSIONS - 1) }]).enough, false);
  assert.deepEqual(aggregateAge([]).groups, []);
});

test('köp är samma köp i flera typer: största värdet, aldrig summan', () => {
  const actions = [{ action_type: 'purchase', value: '3' }, { action_type: 'omni_purchase', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' }];
  assert.equal(actionValue(actions, PURCHASE_TYPES), 3);
});

test('ingen funktion summerar köptyperna (testet fångar den gamla koden)', () => {
  const old = ".filter(a => ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'].includes(a.action_type))\n          .reduce((s, a) => s + parseFloat(a.value || 0), 0);";
  assert.ok(/fb_pixel_purchase[^\n]*\n?\s*\.reduce\(\(s(?:um)?, a\) => s(?:um)? \+/.test(old));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const s = src(f);
    assert.ok(!/fb_pixel_purchase[^\n]*\n?\s*\.reduce\(\(s(?:um)?, a\) => s(?:um)? \+/.test(s), `${f} summerar köptyperna`);
  }
});

test('kampanjlistan hämtar alla sidor från Meta, inte bara de 20 första', () => {
  const s = src('meta-campaigns.js');
  assert.ok(!/campaigns\?fields=[^`]*limit=20/.test(s));
  assert.match(s, /paging\?\.next/);
});

test('kunder ser bara sina egna konverteringar och sitt eget material (filtret kräver !inner)', () => {
  for (const f of ['manual-conversions.js', 'campaign-assets.js']) {
    assert.match(src(f), /budget_plans\$\{isAdmin \? '' : '!inner'\}\(campaign_name, user_id\)/, `${f} filtrerar inte raderna för kunder`);
  }
});
