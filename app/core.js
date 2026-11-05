/* Shadepad core: pure logic. No DOM, no network, no storage.
   findAll() finds likely sensitive values with patterns and checks (no AI).
   redact() replaces them with numbered tags such as [EMAIL_1] and returns the originals in a map.
   restore() puts the originals back into text (an AI reply) that carries those tags.
   Options (all optional): opts.enabled = { KIND: false } switches a category off (missing means on);
   opts.custom = rules from compileCustom(). */
(function (root) {
  'use strict';

  function digitsOf(s) { return s.replace(/\D/g, ''); }

  function luhn(num) {
    var sum = 0, alt = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = num.charCodeAt(i) - 48;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  /* Order matters: an earlier rule claims its text first, so a card number is not also a phone number. */
  var RULES = [
    { kind: 'PRIVATE_KEY', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
    { kind: 'API_KEY', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g },
    { kind: 'API_KEY', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
    { kind: 'API_KEY', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { kind: 'API_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { kind: 'API_KEY', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
    { kind: 'API_KEY', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
    { kind: 'TOKEN', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
    { kind: 'SECRET', re: /\b[\w.-]*?(?:password|passwd|pwd|secret|token|api[_-]?key)\b\s*[:=]\s*["']?([^\s"',;&]{6,})/gi, group: 1 },
    { kind: 'ID_NUMBER', re: /(?<!\d)\d{6}-[1-4]\d{6}(?!\d)/g },
    {
      kind: 'CARD', re: /(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])/g,
      check: function (v) { var d = digitsOf(v); return d.length >= 13 && d.length <= 19 && luhn(d); }
    },
    { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
    {
      kind: 'PHONE', re: /(?<![\w+])(?:\+\d{1,3}[ .-]?)?\(?\d{2,4}\)?[ .-]\d{3,4}[ .-]\d{4}(?!\w)/g,
      check: function (v) { var d = digitsOf(v); return d.length >= 9 && d.length <= 15 && (v.charAt(0) === '+' || d.length <= 11); }
    },
    { kind: 'IP', re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d|\.\d)/g }
  ];

  /* The built-in categories, in the order the switches are shown. */
  var KINDS = ['EMAIL', 'PHONE', 'API_KEY', 'PRIVATE_KEY', 'TOKEN', 'SECRET', 'CARD', 'ID_NUMBER', 'IP'];

  var CUSTOM_MAX_RULES = 20;
  var CUSTOM_MAX_SOURCE = 200;
  var TAG_RE = /\[[A-Z][A-Z0-9_]*_\d+\]/g;
  var TAG_FULL_RE = /^\[[A-Z][A-Z0-9_]*_\d+\]$/;

  /* Returns [{ kind, value, start, end }] sorted by position. Overlaps keep the earlier rule. */
  function findAll(text, opts) {
    var src = String(text == null ? '' : text);
    var enabled = (opts && opts.enabled) || {};
    var custom = (opts && opts.custom) || [];
    var rules = RULES.concat(custom).filter(function (r) { return enabled[r.kind] !== false; });
    /* used[i] marks a character already claimed by an earlier match. Linear in the text length,
       unlike comparing each match with every earlier one (which is quadratic on large logs). */
    var used = new Uint8Array(src.length), out = [];
    rules.forEach(function (rule) {
      var re = new RegExp(rule.re.source, rule.re.flags);
      var m;
      while ((m = re.exec(src)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        var value = rule.group ? m[rule.group] : m[0];
        if (!value) continue;
        var start = rule.group ? m.index + m[0].lastIndexOf(value) : m.index;
        var end = start + value.length;
        if (rule.check && !rule.check(value)) continue;
        var clash = false;
        for (var p = start; p < end; p++) { if (used[p]) { clash = true; break; } }
        if (clash) continue;
        for (p = start; p < end; p++) used[p] = 1;
        out.push({ kind: rule.kind, value: value, start: start, end: end });
      }
    });
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /* The same value always gets the same tag.
     Returns { text, map: { tag: original }, counts: { kind: distinct values }, occurrences, spans }.
     spans lists each replaced place as { start, end, kind, tag } in the input, for the before/after view. */
  function redact(input, opts) {
    var src = String(input == null ? '' : input);
    var found = findAll(src, opts);
    var perKind = {}, tagOf = {}, map = {}, spans = [], parts = [], last = 0;
    found.forEach(function (f) {
      var key = f.kind + '\n' + f.value;
      var tag = tagOf[key];
      if (!tag) {
        perKind[f.kind] = (perKind[f.kind] || 0) + 1;
        tag = '[' + f.kind + '_' + perKind[f.kind] + ']';
        tagOf[key] = tag;
        map[tag] = f.value;
      }
      spans.push({ start: f.start, end: f.end, kind: f.kind, tag: tag });
      parts.push(src.slice(last, f.start), tag);
      last = f.end;
    });
    parts.push(src.slice(last));
    return { text: parts.join(''), map: map, counts: perKind, occurrences: found.length, spans: spans };
  }

  /* Replaces every known tag with its original value, in one pass (a value is never scanned again).
     Returns { text, replaced, unknown }: unknown counts tag-shaped text that is not in the map and is left as it is. */
  function restore(input, map) {
    var s = String(input == null ? '' : input), replaced = 0, unknown = 0;
    var out = s.replace(TAG_RE, function (tag) {
      if (map && Object.prototype.hasOwnProperty.call(map, tag)) { replaced++; return map[tag]; }
      unknown++;
      return tag;
    });
    return { text: out, replaced: replaced, unknown: unknown };
  }

  /* Checks a map from outside (a restored session backup). Returns a clean copy, or null if it is not a tag map. */
  function cleanMap(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    var keys = Object.keys(obj);
    if (keys.length > 5000) return null;
    var out = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!TAG_FULL_RE.test(k) || typeof obj[k] !== 'string' || obj[k].length === 0) return null;
      out[k] = obj[k];
    }
    return out;
  }

  /* Escapes every regex metacharacter, so a rule is always a plain, case-sensitive text match.
     Literal matching is linear in the text length, so no user input can cause catastrophic backtracking. */
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Turns the custom rule text (one literal text per line) into rules.
     Returns { rules: [{ kind: 'CUSTOM', re }], errors: [line numbers] }.
     Lines that are too long or beyond the limit are reported, not used. */
  function compileCustom(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rules = [], errors = [];
    lines.forEach(function (line, i) {
      var s = line.trim();
      if (!s) return;
      if (s.length > CUSTOM_MAX_SOURCE || rules.length >= CUSTOM_MAX_RULES) { errors.push(i + 1); return; }
      rules.push({ kind: 'CUSTOM', re: new RegExp(escapeRe(s), 'g') });
    });
    return { rules: rules, errors: errors };
  }

  /* A short, partly masked view of a value, for the list on screen. */
  function preview(value) {
    var v = String(value == null ? '' : value);
    if (v.indexOf('\n') >= 0) return '(multi-line)';
    if (v.length <= 6) return '•••';
    /* 7 to 10 characters: show only the first and last one, so a short password is not mostly visible. */
    if (v.length <= 10) return v.charAt(0) + '•••' + v.charAt(v.length - 1);
    return v.slice(0, 3) + '•••' + v.slice(-2);
  }

  var SP = {
    findAll: findAll, redact: redact, restore: restore, preview: preview, luhn: luhn,
    KINDS: KINDS, compileCustom: compileCustom, cleanMap: cleanMap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SP;
  else root.SP = SP;
})(typeof window !== 'undefined' ? window : globalThis);
