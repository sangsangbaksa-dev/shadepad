/* Shadepad session backup: encrypts the tag map (the originals) with a passphrase, so restore can work after a reload.
   Pure logic: Web Crypto only, no network, no storage. The backup is a text block that the user copies themselves.
   seal(map, passphrase) -> Promise<string>; open(text, passphrase) -> Promise<map>.
   AES-GCM with a key from PBKDF2-SHA-256. A wrong passphrase or an edited block fails to open. */
(function (root) {
  'use strict';

  var PREFIX = 'SHADEPAD-V1.';
  var ITERATIONS = 310000;

  function webCrypto() {
    var c = (root && root.crypto) || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!c || !c.subtle || typeof c.getRandomValues !== 'function') throw new Error('no-webcrypto');
    return c;
  }

  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function deriveKey(c, passphrase, salt, iterations) {
    var enc = new TextEncoder();
    return c.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return c.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    });
  }

  function seal(map, passphrase) {
    return Promise.resolve().then(function () {
      var c = webCrypto();
      var salt = c.getRandomValues(new Uint8Array(16));
      var iv = c.getRandomValues(new Uint8Array(12));
      var plain = new TextEncoder().encode(JSON.stringify({ v: 1, map: map }));
      return deriveKey(c, String(passphrase), salt, ITERATIONS).then(function (key) {
        return c.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
      }).then(function (ct) {
        var body = JSON.stringify({ i: ITERATIONS, s: toB64(salt), n: toB64(iv), d: toB64(new Uint8Array(ct)) });
        return PREFIX + toB64(new TextEncoder().encode(body));
      });
    });
  }

  function open(text, passphrase) {
    return Promise.resolve().then(function () {
      var c = webCrypto();
      var s = String(text == null ? '' : text).trim();
      if (s.indexOf(PREFIX) !== 0) throw new Error('format');
      var meta = JSON.parse(new TextDecoder().decode(fromB64(s.slice(PREFIX.length))));
      if (!meta || typeof meta.i !== 'number' || meta.i < 1000 || meta.i > 2000000 ||
          typeof meta.s !== 'string' || typeof meta.n !== 'string' || typeof meta.d !== 'string') {
        throw new Error('format');
      }
      var salt = fromB64(meta.s), iv = fromB64(meta.n), data = fromB64(meta.d);
      return deriveKey(c, String(passphrase), salt, meta.i).then(function (key) {
        return c.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
      }).then(function (pt) {
        var obj = JSON.parse(new TextDecoder().decode(pt));
        if (!obj || obj.v !== 1 || !obj.map) throw new Error('format');
        return obj.map;
      });
    });
  }

  var V = { seal: seal, open: open, PREFIX: PREFIX };
  if (typeof module !== 'undefined' && module.exports) module.exports = V;
  else root.SPVault = V;
})(typeof window !== 'undefined' ? window : globalThis);
