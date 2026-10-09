import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = new URL('../netlify/functions/', import.meta.url).pathname;
const functions = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('de gamla inloggningsfunktionerna med användare i minnet finns inte', () => {
  assert.ok(!functions.includes('auth-register.js'));
  assert.ok(!functions.includes('auth-login.js'));
});

test('ingen funktion signerar inloggningar mot användare som bara finns i minnet', () => {
  for (const f of functions) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!/jwt\.sign\(/.test(src)) continue;
    assert.ok(!/const users = \{/.test(src), `${f} har en användarlista i minnet`);
    assert.match(src, /from\('users'\)|from\('invite_tokens'\)|jwt\.verify\(/, `${f} signerar utan att kontrollera användaren`);
  }
});
