const test = require('node:test');
const assert = require('node:assert/strict');
const SP = require('../app/core.js');

const kinds = (text, opts) => SP.findAll(text, opts).map((f) => f.kind);

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

test('a category switched off is not hidden; the others still are', () => {
  assert.deepEqual(SP.findAll('mail a@b.co', { enabled: { EMAIL: false } }), []);
  assert.deepEqual(kinds('mail a@b.co 010-1234-5678', { enabled: { EMAIL: false } }), ['PHONE']);
  assert.deepEqual(kinds('mail a@b.co', { enabled: {} }), ['EMAIL']);
  assert.ok(SP.KINDS.includes('CARD') && SP.KINDS.includes('ID_NUMBER') && SP.KINDS.length === 9);
});

test('custom rules are literal, case-sensitive text, one per line, used by redact', () => {
  const c = SP.compileCustom('ACME-123456\n  internal.corp  \n\n[x*]');
  assert.deepEqual(c.errors, []);
  assert.equal(c.rules.length, 3);
  const r = SP.redact('ACME-123456 and internal.corp, not internalXcorp, and [x*] too', { custom: c.rules });
  assert.equal(r.text, '[CUSTOM_1] and [CUSTOM_2], not internalXcorp, and [CUSTOM_3] too');
});

test('custom rule text is never read as a pattern', () => {
  const c = SP.compileCustom('a.*b\n(a+)+$');
  assert.deepEqual(c.errors, []);
  const r = SP.redact('a.*b and axxb and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', { custom: c.rules });
  assert.equal(r.text, '[CUSTOM_1] and axxb and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!');
});

test('custom rules that are too long or beyond the limit are reported', () => {
  assert.deepEqual(SP.compileCustom('a'.repeat(201)).errors, [1]);
  const many = Array.from({ length: 21 }, (_, i) => 'x' + i).join('\n');
  const c = SP.compileCustom(many);
  assert.equal(c.rules.length, 20);
  assert.deepEqual(c.errors, [21]);
});

test('restore works in one pass, so a restored value is not scanned again', () => {
  const back = SP.restore('[EMAIL_1] [EMAIL_2]', { '[EMAIL_1]': 'x [EMAIL_2] y', '[EMAIL_2]': 'b@c.io' });
  assert.equal(back.text, 'x [EMAIL_2] y b@c.io');
  assert.equal(back.replaced, 2);
});

test('redact reports the spans of each replaced place for the before and after view', () => {
  const r = SP.redact('a@x.io!');
  assert.deepEqual(r.spans, [{ start: 0, end: 6, kind: 'EMAIL', tag: '[EMAIL_1]' }]);
});

test('restore reports tag-shaped text it could not resolve', () => {
  const back = SP.restore('[EMAIL_1] and [EMAIL_7] and [ERROR_2]', { '[EMAIL_1]': 'a@b.co' });
  assert.equal(back.text, 'a@b.co and [EMAIL_7] and [ERROR_2]');
  assert.equal(back.replaced, 1);
  assert.equal(back.unknown, 2);
});

test('a reply with literal tags not in the map keeps them, and each occurrence is handled once', () => {
  const map = { '[EMAIL_1]': 'a@b.co', '[PHONE_1]': '010-1234-5678' };
  const back = SP.restore('[EMAIL_1] [EMAIL_1] [EMAIL_9] [PHONE_1]', map);
  assert.equal(back.text, 'a@b.co a@b.co [EMAIL_9] 010-1234-5678');
  assert.equal(back.replaced, 3);
  assert.equal(back.unknown, 1);
});

test('a tag that is in the map is replaced even if the reply wrote it literally (known limit)', () => {
  assert.equal(SP.restore('say [EMAIL_1]', { '[EMAIL_1]': 'a@b.co' }).text, 'say a@b.co');
});

test('a large log with many matches is hidden in one pass', () => {
  const big = Array.from({ length: 5000 }, (_, i) => 'user' + i + '@example.com').join('\n');
  const r = SP.redact(big);
  assert.equal(r.occurrences, 5000);
  assert.equal(Object.keys(r.map).length, 5000);
});

test('cleanMap accepts only tag maps with text values', () => {
  assert.deepEqual(SP.cleanMap({ '[EMAIL_1]': 'a@b.co' }), { '[EMAIL_1]': 'a@b.co' });
  assert.equal(SP.cleanMap({ 'EMAIL_1': 'x' }), null);
  assert.equal(SP.cleanMap({ '[EMAIL_1]': 5 }), null);
  assert.equal(SP.cleanMap(null), null);
  assert.equal(SP.cleanMap(['x']), null);
});

test('allow list keeps exact values unhidden; other matches still hidden', () => {
  const text = 'write to ops@example.com or dev@acme.io, server 10.0.0.1';
  const all = SP.findAll(text, {}).map((f) => f.value);
  assert.ok(all.includes('ops@example.com') && all.includes('dev@acme.io'));
  const kept = SP.findAll(text, { allow: ['ops@example.com'] }).map((f) => f.value);
  assert.ok(!kept.includes('ops@example.com'));
  assert.ok(kept.includes('dev@acme.io'));
  const r = SP.redact(text, { allow: ['ops@example.com'] });
  assert.ok(r.text.includes('ops@example.com'));
  assert.ok(!r.text.includes('dev@acme.io'));
});
test('allow list is exact and case-sensitive', () => {
  const kept = SP.findAll('Ops@Example.com', { allow: ['ops@example.com'] }).map((f) => f.value);
  assert.deepEqual(kept, ['Ops@Example.com']);
});
test('cleanAllow: trims, drops blanks and duplicates, caps length and count', () => {
  assert.deepEqual(SP.cleanAllow(' a \n\n a\r\nb\n'), { values: ['a', 'b'], dropped: 1 });
  const long = 'x'.repeat(201);
  assert.deepEqual(SP.cleanAllow(long + '\nok'), { values: ['ok'], dropped: 1 });
  const many = Array.from({ length: 55 }, (_, i) => 'v' + i).join('\n');
  const r = SP.cleanAllow(many);
  assert.equal(r.values.length, 50);
  assert.equal(r.dropped, 5);
  assert.deepEqual(SP.cleanAllow(null), { values: [], dropped: 0 });
});
