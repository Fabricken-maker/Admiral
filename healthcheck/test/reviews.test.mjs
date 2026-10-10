import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stuckReviews, aiUnused } from '../src/agents/jobs-reviews.js';

const NOW = new Date('2026-10-12T09:00:00Z').getTime();
const at = (min) => new Date(NOW - min * 60000).toISOString();

test('granskningar som fastnat: köad över 2 timmar, pågående över 30 minuter', () => {
  const rows = [
    { id: 1, status: 'koar', updated_at: at(130) },
    { id: 2, status: 'koar', updated_at: at(60) },
    { id: 3, status: 'analyserar', updated_at: at(31) },
    { id: 4, status: 'analyserar', updated_at: at(5) },
  ];
  assert.deepEqual(stuckReviews(rows, NOW).map((r) => r.id), [1, 3]);
});

test('AI som inte används upptäcks bara när det finns klara granskningar', () => {
  assert.equal(aiUnused([]), false);
  assert.equal(aiUnused([{ status: 'klar', ai_model: null }, { status: 'fel', ai_model: null }]), true);
  assert.equal(aiUnused([{ status: 'klar', ai_model: null }, { status: 'klar', ai_model: 'claude-opus-5-5' }]), false);
});
