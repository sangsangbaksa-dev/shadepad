/* Shadepad UI. Plain DOM, built with textContent and value only (no innerHTML).
   Nothing the user types is stored. This device keeps only the language and the licence key. */
(function () {
  'use strict';

  var I18N = window.SP_I18N || {}, SITE = window.SP_SITE || {}, SP = window.SP;
  var KEY = 'shadepad.v1';
  var LANGS = ['en', 'ko', 'ja', 'zh', 'es'];
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (language and licence only) ---------- */

  function readStore() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ lang: state.lang, license: state.license })); } catch (e) { /* private mode: nothing kept */ }
  }
  function detectLang() {
    var n = ((navigator.language || 'en') + '').slice(0, 2).toLowerCase();
    return LANGS.indexOf(n) >= 0 ? n : 'en';
  }

  var saved = readStore();
  var state = {
    lang: LANGS.indexOf(saved.lang) >= 0 ? saved.lang : detectLang(),
    license: {
      ok: !!(saved.license && saved.license.ok),
      key: saved.license && typeof saved.license.key === 'string' ? saved.license.key : ''
    }
  };

  /* In-memory only: the originals for restoring. Lost on reload by design. */
  var last = null;

  /* ---------- helpers ---------- */

  function t(key, vars) {
    var s = (I18N[state.lang] && I18N[state.lang][key]) || (I18N.en && I18N.en[key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
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
    renderSummary();
    renderTags();
  }

  function renderSummary() {
    var s = $('summary');
    if (!last) { s.textContent = ''; return; }
    s.textContent = last.occurrences === 0 ? t('app_found_none') : t('app_found', { n: last.occurrences });
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

  function setMsg(id, msg) { $(id).textContent = msg || ''; }

  /* ---------- actions ---------- */

  $('redact').addEventListener('click', function () {
    var r = SP.redact($('input').value);
    last = r;
    $('output').value = r.text;
    renderSummary();
    renderTags();
  });

  $('clear').addEventListener('click', function () {
    last = null;
    $('input').value = '';
    $('output').value = '';
    $('reply').value = '';
    $('restored').value = '';
    setMsg('restore_msg', '');
    renderSummary();
    renderTags();
  });

  $('copy').addEventListener('click', function () { copyText('output'); });
  $('copy_restored').addEventListener('click', function () { copyText('restored'); });

  $('restore').addEventListener('click', function () {
    if (!last) { setMsg('restore_msg', t('app_no_map')); return; }
    var r = SP.restore($('reply').value, last.map);
    $('restored').value = r.text;
    setMsg('restore_msg', r.replaced ? t('app_restore_done', { n: r.replaced }) : t('app_restore_none'));
  });

  $('lang').addEventListener('change', function () {
    state.lang = $('lang').value;
    save();
    applyStatic();
    setGateMsg(gateMsgKey);
  });

  /* ---------- licence gate ---------- */

  var gateMsgKey = '';

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

  function setGateMsg(key) {
    gateMsgKey = key || '';
    setMsg('gate_msg', key ? t(key) : '');
  }

  function unlock(key) {
    state.license = { ok: true, key: key };
    save();
    showGate(false);
    setGateMsg('');
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
