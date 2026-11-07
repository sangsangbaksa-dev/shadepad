/* Shadepad UI. Plain DOM, built with textContent and value only (no innerHTML).
   Nothing the user types is stored. This device keeps only the language and the licence key.
   The category switches and custom rules live in memory for this page only. */
(function () {
  'use strict';

  var I18N = window.SP_I18N || {}, SITE = window.SP_SITE || {}, SP = window.SP, VAULT = window.SPVault;
  var KEY = 'shadepad.v1';
  var LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
  var MIN_PASS = 8;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (language and licence only) ---------- */

  function readStore() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ lang: state.lang, license: state.license })); } catch (e) { /* private mode: nothing kept */ }
  }
  function detectLang() {
    var n = ((navigator.language || '') + '').slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : 'ko';
  }

  var saved = readStore();
  var state = {
    lang: LANGS.indexOf(saved.lang) >= 0 ? saved.lang : detectLang(),
    license: {
      ok: !!(saved.license && saved.license.ok),
      key: saved.license && typeof saved.license.key === 'string' ? saved.license.key : ''
    }
  };

  /* In memory only: which categories to look for. A missing entry means on. */
  var detect = {};
  SP.KINDS.forEach(function (k) { detect[k] = true; });

  /* In memory only: the originals for restoring, and the last hide result.
     last.source is the text that was hidden, or null when the map came from a session backup. */
  var last = null;

  /* ---------- helpers ---------- */

  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]) || (I18N.en && I18N.en[key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }

  /* Status messages keep a render function, so they are translated again when the language changes. */
  var msgs = {};
  function setRender(id, fn) {
    msgs[id] = fn || null;
    $(id).textContent = fn ? fn() : '';
  }
  function setMsg(id, key, vars) {
    setRender(id, key ? function () { return t(key, vars); } : null);
  }
  function refreshMsgs() {
    Object.keys(msgs).forEach(function (id) { $(id).textContent = msgs[id] ? msgs[id]() : ''; });
  }

  var toastTimer = null;
  function toast(msg) {
    var n = $('toast');
    n.textContent = msg;
    n.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.classList.remove('show'); }, 1600);
  }

  function copyText(id) {
    var ta = $(id);
    var text = ta.value;
    if (!text) return;
    var fallback = function () {
      ta.removeAttribute('readonly');
      ta.select();
      try { document.execCommand('copy'); toast(t('app_copied')); } catch (e) { /* nothing else to try */ }
      ta.setAttribute('readonly', '');
      ta.setSelectionRange(0, 0);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(t('app_copied')); }, fallback);
    } else {
      fallback();
    }
  }

  /* ---------- rendering ---------- */

  function applyStatic() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t(n.dataset.t); });
    document.querySelectorAll('[data-p]').forEach(function (n) { n.placeholder = t(n.dataset.p); });
    $('lang').value = state.lang;
    var buy = $('buy');
    if (SITE.checkoutUrl) { buy.href = SITE.checkoutUrl; buy.hidden = false; } else { buy.hidden = true; }
    renderKinds();
    renderSummary();
    renderTags();
    renderDiff();
    updateStale();
    renderLocal();
    renderAiItems();
    renderAiKeyMsg();
    updateAi();
    refreshMsgs();
  }

  function renderKinds() {
    var box = $('kinds');
    box.textContent = '';
    SP.KINDS.forEach(function (k) {
      var label = document.createElement('label');
      label.className = 'kind-opt';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = detect[k] !== false;
      cb.dataset.kind = k;
      var name = document.createElement('span');
      name.textContent = t('app_kind_' + k);
      label.appendChild(cb);
      label.appendChild(name);
      box.appendChild(label);
    });
  }

  /* Places per category, e.g. "Email 2, API key 1", counted from the spans of the last hide. */
  function breakdown() {
    var per = {}, order = [];
    last.spans.forEach(function (sp) {
      if (!per[sp.kind]) { per[sp.kind] = 0; order.push(sp.kind); }
      per[sp.kind]++;
    });
    return order.map(function (k) { return t('app_kind_' + k) + ' ' + per[k]; }).join(', ');
  }

  function renderSummary() {
    var s = $('summary');
    if (!last) { s.textContent = ''; return; }
    var distinct = Object.keys(last.map).length;
    if (last.source === null) {
      s.textContent = t('app_map_loaded', { n: distinct });
    } else if (last.occurrences === 0) {
      s.textContent = t('app_found_none');
    } else {
      s.textContent = t('app_found', { n: distinct, m: last.occurrences }) + ' (' + breakdown() + ')';
    }
  }

  function kindOf(tag) { return tag.slice(1, tag.lastIndexOf('_')); }

  function renderTags() {
    var list = $('tags');
    list.textContent = '';
    if (!last) return;
    Object.keys(last.map).forEach(function (tag) {
      var li = document.createElement('li');
      var code = document.createElement('code');
      code.textContent = tag;
      var kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = t('app_kind_' + kindOf(tag));
      var pv = document.createElement('span');
      pv.className = 'pv';
      pv.textContent = SP.preview(last.map[tag]);
      li.appendChild(code);
      li.appendChild(kind);
      li.appendChild(pv);
      list.appendChild(li);
    });
  }

  /* Before and after: the hidden text with each replaced place shown as a struck-through value and its tag. */
  function renderDiff() {
    var box = $('diff'), wrap = $('diff_wrap');
    box.textContent = '';
    if (!last || !last.spans || last.spans.length === 0) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var src = last.source, pos = 0;
    last.spans.forEach(function (sp) {
      if (sp.start > pos) box.appendChild(document.createTextNode(src.slice(pos, sp.start)));
      var del = document.createElement('del');
      del.textContent = src.slice(sp.start, sp.end);
      var ins = document.createElement('ins');
      ins.textContent = sp.tag;
      box.appendChild(del);
      box.appendChild(ins);
      pos = sp.end;
    });
    if (pos < src.length) box.appendChild(document.createTextNode(src.slice(pos)));
  }

  /* Warns when the text was edited after the last hide, so the copied output is not stale.
     Also enables a copy button only when there is something to copy. */
  function updateStale() {
    var on = !!last && last.source !== null && $('input').value !== last.source;
    $('stale').hidden = !on;
    $('stale').textContent = on ? t('app_stale') : '';
    $('copy').disabled = !$('output').value;
    $('copy_restored').disabled = !$('restored').value;
    $('copy_backup').disabled = !$('backup_out').value;
  }

  /* ---------- actions ---------- */

  $('kinds').addEventListener('change', function (e) {
    var k = e.target && e.target.dataset ? e.target.dataset.kind : '';
    if (k) detect[k] = e.target.checked;
  });

  function setAllKinds(on) {
    SP.KINDS.forEach(function (k) { detect[k] = on; });
    renderKinds();
  }
  $('kinds_all').addEventListener('click', function () { setAllKinds(true); });
  $('kinds_none').addEventListener('click', function () { setAllKinds(false); });

  $('input').addEventListener('input', updateStale);

  /* Ctrl+Enter (Cmd+Enter on Mac) hides details from either text box, and restores from the AI reply box. */
  ['input', 'custom', 'allow'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('redact').click(); }
    });
  });
  $('reply').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('restore').click(); }
  });

  $('redact').addEventListener('click', function () {
    var custom = SP.compileCustom($('custom').value);
    if (custom.errors.length) {
      $('custom_box').open = true;
      setRender('custom_msg', function () { return t('app_custom_err', { lines: custom.errors.join(', ') }); });
      return;
    }
    setMsg('custom_msg', null);
    var source = $('input').value;
    var r = SP.redact(source, { enabled: detect, custom: custom.rules, allow: SP.cleanAllow($('allow').value).values });
    r.source = source;
    last = r;
    $('output').value = r.text;
    renderSummary();
    renderTags();
    renderDiff();
    updateStale();
    resetAi();
    localRes = SP.localCheck(r.text);
    renderLocal();
    updateAi();
  });

  $('clear').addEventListener('click', function () {
    last = null;
    $('input').value = '';
    $('output').value = '';
    $('reply').value = '';
    $('restored').value = '';
    $('backup_out').value = '';
    $('backup_in').value = '';
    $('pass').value = '';
    setMsg('restore_msg', null);
    setMsg('bk_msg', null);
    setMsg('custom_msg', null);
    renderSummary();
    renderTags();
    renderDiff();
    updateStale();
    resetAi();
    localRes = null;
    renderLocal();
    updateAi();
  });

  $('copy').addEventListener('click', function () { copyText('output'); });
  $('copy_restored').addEventListener('click', function () { copyText('restored'); });
  $('copy_backup').addEventListener('click', function () { copyText('backup_out'); });

  $('restore').addEventListener('click', function () {
    if (!last) { setMsg('restore_msg', 'app_no_map'); return; }
    var r = SP.restore($('reply').value, last.map);
    $('restored').value = r.text;
    setRender('restore_msg', function () {
      var a = r.replaced ? t('app_restore_done', { n: r.replaced }) : t('app_restore_none');
      return r.unknown ? a + ' ' + t('app_restore_unknown', { n: r.unknown }) : a;
    });
    updateStale();
  });

  /* ---------- AI check (optional, your own API key) ---------- */

  /* The key is kept in this browser under AI_KEY, and only sent to api.anthropic.com when the run button is pressed.
     If the browser refuses to store it, it is kept for this page only. */
  var AI_KEY = 'shadepad-ai-key';
  var aiMemKey = '';
  var localRes = null; /* SP.localCheck result for the current hidden text */
  var aiRes = null;    /* { items, none } from the AI reply for the current hidden text */
  var aiBusy = false;
  var aiSeq = 0;       /* bumped whenever the hidden text changes, so a late reply is dropped */

  function readAiKey() {
    try {
      var v = localStorage.getItem(AI_KEY);
      if (v && v.trim()) return v.trim();
    } catch (e) { /* storage blocked: use the page copy */ }
    return aiMemKey;
  }
  function saveAiKey(k) {
    try { localStorage.setItem(AI_KEY, k); aiMemKey = ''; return true; } catch (e) { aiMemKey = k; return false; }
  }
  function forgetAiKey() {
    aiMemKey = '';
    try { localStorage.removeItem(AI_KEY); } catch (e) { /* nothing stored */ }
  }

  function renderLocal() {
    var list = $('ai_local');
    list.textContent = '';
    if (!localRes) { setMsg('ai_local_sum', 'ai_local_empty'); return; }
    setRender('ai_local_sum', function () { return t('ai_local_sum', { n: localRes.total, m: localRes.leftovers.length }); });
    if (localRes.leftovers.length === 0) {
      var none = document.createElement('li');
      none.textContent = t('ai_local_none');
      list.appendChild(none);
      return;
    }
    localRes.leftovers.forEach(function (x) {
      var li = document.createElement('li');
      var kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = t('ai_left_' + x.kind);
      var pv = document.createElement('span');
      pv.className = 'pv';
      pv.textContent = SP.preview(x.value);
      li.appendChild(kind);
      li.appendChild(pv);
      list.appendChild(li);
    });
  }

  function renderAiItems() {
    var list = $('ai_items');
    list.textContent = '';
    if (!aiRes) return;
    if (aiRes.none) {
      var none = document.createElement('li');
      none.textContent = t('ai_none');
      list.appendChild(none);
    }
    aiRes.items.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      list.appendChild(li);
    });
  }

  function renderAiKeyMsg() {
    setRender('ai_key_msg', function () {
      var k = readAiKey();
      return k ? t('ai_key_saved', { tail: k.slice(-4) }) : t('ai_key_none');
    });
  }

  /* The run button needs a key and hidden text. A missing one is named in the status line;
     that line is cleared only when the reason was ours, so a run result or error is never wiped here. */
  var aiReason = null;
  function updateAi() {
    var hasKey = !!readAiKey(), hasText = !!$('output').value;
    $('ai_run').disabled = !hasKey || !hasText || aiBusy;
    if (aiBusy) return;
    var reason = !hasText ? 'ai_need_text' : !hasKey ? 'ai_need_key' : null;
    if (reason) { aiReason = reason; setMsg('ai_msg', reason); }
    else if (aiReason) { aiReason = null; setMsg('ai_msg', null); }
  }

  function resetAi() {
    aiSeq++;
    aiBusy = false;
    aiRes = null;
    aiReason = null;
    renderAiItems();
    setMsg('ai_msg', null);
  }

  function aiErrorKey(e) {
    if (!e || typeof e.status !== 'number') return 'ai_err_net';
    if (e.status === 401 || e.status === 403) return 'ai_err_key';
    if (e.status === 429) return 'ai_err_rate';
    return 'ai_err_http';
  }

  /* Sends the HIDDEN text (the output box) with the check instruction. Never the originals. Runs only on click. */
  function runAi() {
    var key = readAiKey(), hidden = $('output').value;
    if (!key || !hidden || aiBusy) return;
    var seq = aiSeq;
    aiBusy = true;
    aiRes = null;
    renderAiItems();
    setMsg('ai_msg', 'ai_working');
    updateAi();
    var body = JSON.stringify(SP.requestBody(SP.checkPrompt(hidden, state.lang)));
    var req;
    try {
      req = fetch(SP.AI.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': SP.AI.version,
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: body,
        cache: 'no-store'
      });
    } catch (e) {
      req = Promise.reject(e);
    }
    req.then(function (r) {
      if (!r.ok) { var err = new Error('http'); err.status = r.status; throw err; }
      return r.json();
    }).then(function (j) {
      if (seq !== aiSeq) return;
      var parsed = SP.parseCheckReply(SP.replyText(j));
      if (!parsed.none && parsed.items.length === 0) { aiRes = null; setMsg('ai_msg', 'ai_bad_reply'); return; }
      aiRes = parsed;
      setMsg('ai_msg', 'ai_done');
    }).catch(function (e) {
      if (seq !== aiSeq) return;
      aiRes = null;
      setMsg('ai_msg', aiErrorKey(e));
    }).then(function () {
      if (seq !== aiSeq) return;
      aiBusy = false;
      renderAiItems();
      updateAi();
    });
  }

  $('ai_run').addEventListener('click', runAi);

  $('ai_save').addEventListener('click', function () {
    var k = $('ai_key').value.trim();
    if (!k) { setMsg('ai_key_msg', 'ai_key_empty'); return; }
    var stored = saveAiKey(k);
    $('ai_key').value = '';
    if (stored) renderAiKeyMsg(); else setMsg('ai_key_msg', 'ai_key_nostore');
    updateAi();
  });

  $('ai_forget').addEventListener('click', function () {
    forgetAiKey();
    $('ai_key').value = '';
    renderAiKeyMsg();
    updateAi();
  });

  /* ---------- encrypted session backup ---------- */

  function vaultError(e, fallbackKey) {
    if (!VAULT || (e && e.message === 'no-webcrypto')) return 'bk_nocrypto';
    return fallbackKey;
  }

  function passOk() { return $('pass').value.length >= MIN_PASS; }

  $('bk_make').addEventListener('click', function () {
    if (!VAULT) { setMsg('bk_msg', 'bk_nocrypto'); return; }
    if (!last || Object.keys(last.map).length === 0) { setMsg('bk_msg', 'bk_need_map'); return; }
    if (!passOk()) { setMsg('bk_msg', 'bk_short'); return; }
    setMsg('bk_msg', 'bk_working');
    VAULT.seal(last.map, $('pass').value).then(function (text) {
      $('backup_out').value = text;
      setMsg('bk_msg', 'bk_done');
      updateStale();
    }, function (e) { setMsg('bk_msg', vaultError(e, 'bk_fail')); });
  });

  $('bk_load').addEventListener('click', function () {
    var text = $('backup_in').value.trim();
    if (!text) { setMsg('bk_msg', 'bk_bad'); return; }
    if (!VAULT) { setMsg('bk_msg', 'bk_nocrypto'); return; }
    if (!passOk()) { setMsg('bk_msg', 'bk_short'); return; }
    setMsg('bk_msg', 'bk_working');
    VAULT.open(text, $('pass').value).then(function (raw) {
      var map = SP.cleanMap(raw);
      if (!map || Object.keys(map).length === 0) { setMsg('bk_msg', 'bk_bad'); return; }
      last = { map: map, occurrences: Object.keys(map).length, spans: [], source: null, text: '' };
      setMsg('bk_msg', null);
      renderSummary();
      renderTags();
      renderDiff();
      updateStale();
    }, function (e) { setMsg('bk_msg', vaultError(e, 'bk_bad')); });
  });

  $('lang').addEventListener('change', function () {
    state.lang = $('lang').value;
    save();
    applyStatic();
  });

  /* ---------- licence gate ---------- */

  function verify(key) {
    return fetch('/api/license', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: key || '' }),
      cache: 'no-store'
    }).then(function (r) { return r.json(); });
  }

  function reasonKey(reason) {
    if (reason === 'invalid') return 'gate_invalid';
    if (reason === 'refunded') return 'gate_refunded';
    if (reason === 'unreachable') return 'gate_unreachable';
    return '';
  }

  function showGate(on) {
    $('gate').hidden = !on;
    $('main').hidden = on;
  }

  function setGateMsg(key) { setMsg('gate_msg', key); }

  function unlock(key) {
    state.license = { ok: true, key: key };
    save();
    showGate(false);
    setGateMsg(null);
  }

  $('unlock').addEventListener('click', function () {
    var key = $('key').value.trim();
    if (!key) return;
    setGateMsg('gate_checking');
    verify(key).then(function (j) {
      if (j && j.configured === false) { showGate(false); return; }
      if (j && j.ok) { unlock(key); return; }
      setGateMsg(reasonKey(j && j.reason) || 'gate_invalid');
    }).catch(function () { setGateMsg('gate_unreachable'); });
  });

  $('key').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('unlock').click();
  });

  function boot() {
    applyStatic();
    if (state.license.ok) return; // unlocked on this device before
    // Ask the server whether the app is on sale. Not on sale yet: the app stays open.
    verify(state.license.key).then(function (j) {
      if (j && j.configured === false) return;
      if (j && j.ok) { unlock(state.license.key); return; }
      showGate(true);
      setGateMsg(reasonKey(j && j.reason));
    }).catch(function () {
      showGate(true);
      setGateMsg('gate_unreachable');
    });
  }

  boot();
})();
