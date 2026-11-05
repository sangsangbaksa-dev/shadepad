/* Playwright check for the AI check panel. The Anthropic API is mocked with page.route, so no request leaves the test.
   Run: NODE_PATH=$(npm root -g) node test/ai-e2e.js */
const { chromium } = require('playwright'), http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..'), types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(fs.readFileSync(f));
}).listen(0);
const ORIGINAL_EMAIL = 'alice.kim@example.com', ORIGINAL_KEY = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWx1234', TAIL = '1234';
const INPUT = 'Contact ' + ORIGINAL_EMAIL + ' and use ' + ORIGINAL_KEY + ' for the staging job. Customer Name: Kim Minsu, host db.corp';

(async () => {
  const base = `http://localhost:${srv.address().port}`, errs = [];
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('shadepad.v1')) localStorage.setItem('shadepad.v1', JSON.stringify({ lang: 'en', license: { ok: true, key: 'x' } })); } catch (e) {} });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // Mock the API: record every request, reply with a fixed answer that includes HTML-looking text.
  const calls = [];
  let replyMode = 'ok';
  await pg.route('https://api.anthropic.com/v1/messages', async route => {
    calls.push({ headers: route.request().headers(), body: route.request().postData() });
    if (replyMode === 'auth') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"type":"error"}' });
    const text = '- Customer name "Kim Minsu" next to a label <img src=x onerror="window.__xss=1">\n- Internal host db.corp\n- none';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }] }) });
  });

  await pg.goto(base + '/app/index.html', { waitUntil: 'load' });
  assert.equal(await pg.locator('#ai_run').isDisabled(), true, 'run is disabled before any text');

  // Hide details: the original text is replaced, the local check runs, and nothing is sent.
  await pg.fill('#input', INPUT);
  await pg.click('#redact');
  const out = await pg.inputValue('#output');
  assert.ok(!out.includes(ORIGINAL_EMAIL) && !out.includes(ORIGINAL_KEY), 'hidden output has no originals');
  const local = await pg.locator('#ai_local li').allTextContents();
  assert.ok(local.some(t => t.includes('Labelled value')), 'local check finds the labelled name: ' + local.join(' | '));
  assert.ok(local.some(t => t.includes('Internal host')), 'local check finds the host');
  assert.equal(calls.length, 0, 'no network call before a click');

  // Without a key the run button stays off and the reason is shown.
  assert.equal(await pg.locator('#ai_run').isDisabled(), true, 'run needs a key');
  assert.match(await pg.textContent('#ai_msg'), /Save an API key/);

  // Save a key. It is stored under shadepad-ai-key and only its last four characters are shown.
  await pg.evaluate(() => { document.querySelector('.ai-key').open = true; });
  await pg.fill('#ai_key', 'test-key-' + TAIL);
  await pg.click('#ai_save');
  assert.equal(await pg.evaluate(() => localStorage.getItem('shadepad-ai-key')), 'test-key-' + TAIL, 'key stored under the agreed name');
  assert.match(await pg.textContent('#ai_key_msg'), /ends with 1234/);
  assert.equal(await pg.inputValue('#ai_key'), '', 'the key field is cleared after saving');
  assert.equal(await pg.locator('#ai_run').isDisabled(), false, 'run is enabled with a key and hidden text');
  assert.equal(calls.length, 0, 'saving a key does not send anything');

  // Click: one request, with the right headers, the Haiku model, and no original values.
  await pg.click('#ai_run');
  await pg.waitForFunction(() => document.getElementById('ai_msg').textContent.length > 0 && !document.getElementById('ai_run').disabled);
  assert.equal(calls.length, 1, 'exactly one request after the click');
  const h = calls[0].headers;
  assert.equal(h['x-api-key'], 'test-key-' + TAIL);
  assert.equal(h['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(h['anthropic-version'], '2023-06-01');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.model, 'claude-haiku-5-5');
  assert.ok(!calls[0].body.includes(ORIGINAL_EMAIL) && !calls[0].body.includes(ORIGINAL_KEY), 'request has no originals');
  assert.ok(calls[0].body.includes('[EMAIL_1]'), 'request has the hidden text');

  // The reply is shown with textContent: the injected tag is text, not an element.
  const items = await pg.locator('#ai_items li').allTextContents();
  assert.equal(items.length, 2, 'two suggestions shown; "none" line is ignored: ' + JSON.stringify(items));
  assert.equal(await pg.locator('#ai_items img').count(), 0, 'model output is never parsed as HTML');
  assert.equal(await pg.evaluate(() => window.__xss), undefined, 'no script ran from the reply');
  assert.match(await pg.textContent('#ai_msg'), /second opinion/);

  // Editing the hidden text clears the reply, because it no longer matches the text it was about.
  await pg.click('#clear');
  assert.equal(await pg.locator('#ai_items li').count(), 0, 'reply cleared with the text');

  // A rejected key shows a message and no crash.
  replyMode = 'auth';
  await pg.fill('#input', INPUT);
  await pg.click('#redact');
  await pg.click('#ai_run');
  await pg.waitForFunction(() => /rejected/.test(document.getElementById('ai_msg').textContent));
  assert.match(await pg.textContent('#ai_msg'), /rejected/);
  replyMode = 'ok';

  // Remove the key: the run button turns off again and the stored key is gone.
  await pg.click('#ai_forget');
  assert.equal(await pg.evaluate(() => localStorage.getItem('shadepad-ai-key')), null, 'key removed');
  assert.equal(await pg.locator('#ai_run').isDisabled(), true);

  // Layout at 390px: no horizontal overflow.
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, 'horizontal overflow ' + overflow);

  // Language switch refreshes the panel text.
  await pg.selectOption('#lang', 'ko');
  assert.match(await pg.textContent('#ai_h'), /AI 점검/);

  console.log('errors seen:', JSON.stringify(errs));
  // Chrome logs every failed HTTP response; the only one expected here is the deliberate 401 in the rejected-key step.
  assert.deepEqual(errs.filter(e => !/status of 401 \(Unauthorized\)/.test(e)), [], 'no console or page errors other than the deliberate 401');
  console.log('ai-e2e: all checks passed');
  await b.close(); srv.close();
})().catch(e => { console.error('ai-e2e FAILED:', e.message); process.exit(1); });
