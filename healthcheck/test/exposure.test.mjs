import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddresses, exposedOn } from '../src/lib/exposure.js';

test('bara serverns publika adresser kontrolleras, inte loopback och Docker', () => {
  const ifs = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [{ address: '203.0.113.7', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false }],
    'br-abc': [{ address: '172.18.0.1', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(publicAddresses(ifs), ['203.0.113.7']);
});

test('en port som svarar på den publika adressen räknas som öppen', async () => {
  assert.deepEqual(await exposedOn(8000, { addresses: ['203.0.113.7'], connect: async () => true }), ['203.0.113.7']);
  assert.deepEqual(await exposedOn(8000, { addresses: ['203.0.113.7'], connect: async () => false }), []);
});
