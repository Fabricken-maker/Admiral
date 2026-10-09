import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unmatchedActivities } from '../src/agents/jobs-approvals.js';
import { checkRequest } from '../src/lib/guard.js';

const APP = '1234';
const log = (object_id, created_at, request = {}) => ({ object_id, created_at, request });

test('ändring av Admirals app utan loggad skrivning flaggas', () => {
  const acts = [
    { application_id: APP, object_id: '700', event_type: 'update_ad_set_budget', event_time: '2026-10-09T12:00:30+0000' },
    { application_id: APP, object_id: '800', event_type: 'update_ad_run_status', event_time: '2026-10-09T12:05:00+0000' },
    { application_id: '0', object_id: '900', event_type: 'update_ad_set_budget', event_time: '2026-10-09T12:05:00+0000' }, // Ads Manager
  ];
  const logs = [log('700', '2026-10-09T12:00:00Z', { 700: { daily_budget: 6000 } })];
  const u = unmatchedActivities(acts, logs, APP);
  assert.deepEqual(u.map((a) => a.object_id), ['800']);
});

test('loggad skrivning matchar även via objekten i request och bara inom 15 minuter', () => {
  const acts = [{ application_id: APP, object_id: '701', event_time: '2026-10-09T12:10:00+0000' }];
  assert.equal(unmatchedActivities(acts, [log('700', '2026-10-09T12:00:00Z', { 700: {}, 701: {} })], APP).length, 0);
  assert.equal(unmatchedActivities(acts, [log('701', '2026-10-09T11:40:00Z')], APP).length, 1);
});

test('spärren: bara meta_token_put får skrivas via RPC', () => {
  const opts = { supabaseUrl: 'https://exempel.supabase.co' };
  assert.doesNotThrow(() => checkRequest('POST', 'https://exempel.supabase.co/rest/v1/rpc/meta_token_put', opts));
  assert.doesNotThrow(() => checkRequest('GET', 'https://exempel.supabase.co/rest/v1/rpc/meta_token_get?p_user_id=3', opts));
  assert.throws(() => checkRequest('POST', 'https://exempel.supabase.co/rest/v1/rpc/exec_sql', opts));
  assert.throws(() => checkRequest('PATCH', 'https://exempel.supabase.co/rest/v1/proposals?id=eq.1', opts));
  assert.throws(() => checkRequest('PATCH', 'https://exempel.supabase.co/rest/v1/write_settings?user_id=eq.3', opts));
});
