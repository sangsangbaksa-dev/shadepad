const test = require('node:test');
const assert = require('node:assert/strict');
const SP = require('../app/core.js');

const kinds = (text) => SP.findAll(text).map((f) => f.kind);

test('API keys and tokens of common providers are found', () => {
  const text = [
    'openai sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2',
    'anthropic sk-ant-api03-' + 'x'.repeat(30),
    'github ghp_' + 'a'.repeat(36),
    'aws AKIA' + 'ABCDEFGHIJKLMNOP',
    'google AIza' + 'a'.repeat(35),
    'slack xoxb-1234567890-abcdefghij',
    'stripe sk_live_' + 'a'.repeat(20),
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijklmnop'
  ].join('\n');
  const found = SP.findAll(text);
  assert.equal(found.filter((f) => f.kind === 'API_KEY').length, 7);
  assert.equal(found.filter((f) => f.kind === 'TOKEN').length, 1);
});

test('private key blocks are found across lines', () => {
  const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\nabc123\n-----END RSA PRIVATE KEY-----';
  const r = SP.redact('before\n' + block + '\nafter');
  assert.equal(r.text, 'before\n[PRIVATE_KEY_1]\nafter');
});

test('password and secret assignments hide only the value', () => {
  const r = SP.redact('DB_PASSWORD=hunter2hunter2 and api_key: "abcdef123456"');
  assert.equal(r.text, 'DB_PASSWORD=[SECRET_1] and api_key: "[SECRET_2]"');
  assert.equal(r.map['[SECRET_1]'], 'hunter2hunter2');
});

test('emails, Korean and international phone numbers, IPv4 and resident IDs are found', () => {
  assert.deepEqual(kinds('mail kim.minsu+test@example.co.kr'), ['EMAIL']);
  assert.deepEqual(kinds('call 010-1234-5678 now'), ['PHONE']);
  assert.deepEqual(kinds('call +82 10 1234 5678'), ['PHONE']);
  assert.deepEqual(kinds('host 192.168.0.12 is up'), ['IP']);
  assert.deepEqual(kinds('id 900101-1234567'), ['ID_NUMBER']);
});

test('card numbers need a valid Luhn check and are not also reported as phones', () => {
  assert.equal(SP.luhn('4111111111111111'), true);
  assert.deepEqual(kinds('card 4111 1111 1111 1111'), ['CARD']);
  assert.deepEqual(kinds('card 4111 1111 1111 1112'), []);
});

test('ordinary dates, times, versions and short numbers are not flagged', () => {
  assert.deepEqual(SP.findAll('Build at 2026-11-03 13:04:05, took 1234 ms, version 1.2.3, order 1699999999'), []);
});

test('the same value gets the same tag; different values get numbered tags', () => {
  const r = SP.redact('a@x.io, b@x.io, a@x.io');
  assert.equal(r.text, '[EMAIL_1], [EMAIL_2], [EMAIL_1]');
  assert.deepEqual(r.counts, { EMAIL: 2 });
  assert.equal(r.occurrences, 3);
  assert.equal(r.map['[EMAIL_2]'], 'b@x.io');
});

test('redact then restore gives back the original text, including after an AI reply', () => {
  const original = 'Mail kim@example.com or call 010-1234-5678. Card 4111 1111 1111 1111.';
  const r = SP.redact(original);
  assert.equal(r.text, 'Mail [EMAIL_1] or call [PHONE_1]. Card [CARD_1].');
  const reply = 'Reply to [EMAIL_1] and call [PHONE_1]. [EMAIL_1] again.';
  const back = SP.restore(reply, r.map);
  assert.equal(back.text, 'Reply to kim@example.com and call 010-1234-5678. kim@example.com again.');
  assert.equal(back.replaced, 3);
  assert.equal(SP.restore(r.text, r.map).text, original);
});

test('restore leaves unknown tags and plain text alone', () => {
  const back = SP.restore('See [EMAIL_9] and nothing else', { '[EMAIL_1]': 'a@b.co' });
  assert.equal(back.text, 'See [EMAIL_9] and nothing else');
  assert.equal(back.replaced, 0);
});

test('preview masks the middle of a value and hides short ones', () => {
  assert.equal(SP.preview('kim@example.com'), 'kim•••om');
  assert.equal(SP.preview('abc'), '•••');
  assert.equal(SP.preview('a\nb'), '(multi-line)');
});

test('empty and missing input are safe', () => {
  assert.equal(SP.redact(null).text, '');
  assert.equal(SP.redact(undefined).occurrences, 0);
  assert.equal(SP.restore(null, null).text, '');
});
