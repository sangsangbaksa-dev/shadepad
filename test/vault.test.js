const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const V = require('../app/vault.js');

const map = { '[EMAIL_1]': 'kim@example.com', '[SECRET_1]': 'hunter2hunter2' };

test('a sealed backup opens with the right passphrase and gives the same map back', async () => {
  const sealed = await V.seal(map, 'correct horse battery');
  assert.ok(sealed.startsWith(V.PREFIX));
  assert.ok(!sealed.includes('kim@example.com') && !sealed.includes('hunter2'));
  assert.deepEqual(await V.open(sealed, 'correct horse battery'), map);
});

test('a wrong passphrase is rejected', async () => {
  const sealed = await V.seal(map, 'correct horse battery');
  await assert.rejects(V.open(sealed, 'wrong passphrase'));
});

test('an edited backup is rejected', async () => {
  const sealed = await V.seal(map, 'correct horse battery');
  const meta = JSON.parse(Buffer.from(sealed.slice(V.PREFIX.length), 'base64').toString('utf8'));
  meta.d = (meta.d.charAt(0) === 'A' ? 'B' : 'A') + meta.d.slice(1);
  const tampered = V.PREFIX + Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
  await assert.rejects(V.open(tampered, 'correct horse battery'));
});

test('text that is not a backup is rejected', async () => {
  await assert.rejects(V.open('hello', 'correct horse battery'), /format/);
  await assert.rejects(V.open(V.PREFIX + 'not-base64!!', 'correct horse battery'));
});
