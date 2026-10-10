import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalsWithoutApprovedVariant, swapsNotCreatedPaused } from '../src/agents/jobs-fatigue.js';

test('förslag om byte med en variant som inte är godkänd larmar', () => {
  const reviews = [
    { id: 1, fatigue_id: 9, status: 'klar', verdict: 'godkand' },
    { id: 2, fatigue_id: 9, status: 'klar', verdict: 'underkand' },
    { id: 3, fatigue_id: 9, status: 'klar', verdict: 'granska', decided_verdict: 'godkand' },
  ];
  const proposals = [
    { id: 10, kind: 'change', meta: { variant_review_id: 1 } },
    { id: 11, kind: 'change', meta: { variant_review_id: 2 } },
    { id: 12, kind: 'change', meta: { variant_review_id: 3 } },
    { id: 13, kind: 'change', meta: { variant_review_id: 99 } },
    { id: 14, kind: 'undo', meta: {} },
  ];
  assert.deepEqual(proposalsWithoutApprovedVariant(proposals, reviews).map((p) => p.id), [11, 13]);
});

test('byte utan bekräftelse på att annonsen skapades pausad larmar', () => {
  const logs = [
    { id: 1, action: 'apply', status: 'done', request: { created: { status: 'PAUSED' } } },
    { id: 2, action: 'apply', status: 'done', request: { created: { status: 'ACTIVE' } } },
    { id: 3, action: 'apply', status: 'failed', request: {} },
    { id: 4, action: 'undo', status: 'done', request: {} },
  ];
  assert.deepEqual(swapsNotCreatedPaused(logs).map((l) => l.id), [2]);
});
