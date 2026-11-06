# Shadepad

A browser-only tool that hides likely secrets (API keys, passwords in config lines, private key blocks, JWTs, emails, phone numbers, IP addresses, card numbers and Korean resident IDs) before you paste text into an AI tool, and puts the original values back into the AI's reply. Static site, no server of its own, no AI API calls, no upload. 5 languages (en, ko, ja, zh, es).

Working name: the folder and the product name are not final. Check trademarks (KIPRIS / USPTO / EUIPO) before launch and rename the folder and `config.js` if needed. Names of AI and other companies appear only to describe what the patterns detect, and the landing page carries a non-affiliation notice.

## What it does

- **Hide details**: finds the values with patterns and checks (Luhn for card numbers, digit counts for phones) and replaces each with a numbered tag such as `[EMAIL_1]`. The same value always gets the same tag. The app lists what was found, with a partly masked preview.
- **Per-category switches**: each of the nine built-in categories (email, phone, API key, private key, token, password or secret, card number, resident ID, IP address) can be turned off for the page. Switches are kept in memory only.
- **Custom rules**: exact text to hide, one per line (for example `ACME-123456` or `internal.corp`). Rules are plain text, not patterns, and case-sensitive. They are limited to 20 rules of at most 200 characters, and over-long lines are reported instead of used. Matches are hidden as `[CUSTOM_n]`. Ctrl+Enter (Cmd+Enter) hides details from the text boxes, and restores from the AI reply box.
- **Summary and before/after view**: the count line says how many values were hidden and in how many places. A before/after view shows each replaced place, struck through, beside its tag, and a notice appears if the text was edited after the last hide.
- **Restore**: paste the AI reply into the restore box and the tags become the original values again. Restore reads each tag once, so a restored value is never changed a second time. Only tags from the most recent "Hide details" on the page can be restored, unless a session backup has been opened.
- **Copy** the hidden text or the restored text.
- **Session backup (optional)**: the originals can be saved as one text block encrypted with a passphrase (AES-GCM, key from PBKDF2-SHA-256, 310,000 iterations). Paste it back after a reload and restore works again. The block is shown on the page for you to copy; nothing is uploaded or stored. Without the passphrase it cannot be opened, and a lost passphrase means the backup is lost.
- **Nothing stored**: the text and the originals stay in memory on the page. Reloading clears them. Only the language and, after unlocking, the licence key are kept in `localStorage`.

## Layout

- `index.html`, `landing.css`, `landing.js`: landing page.
- `privacy.html`, `terms.html`: legal pages, text in `i18n.js`.
- `i18n.js`: all user-visible strings (five languages, same keys).
- `config.js`: `siteUrl`, `checkoutUrl`, `price`. Change these before launch.
- `app/`: the app. `core.js` is pure logic (no DOM, no network, no storage) and is unit-tested: detection, switches, custom rules, redact, restore. `vault.js` is the passphrase encryption for session backups (Web Crypto only). `app.js` builds the UI with `textContent` and `value` only.
- `functions/api/license.js` + `lib/license-core.js`: Cloudflare Pages Function for the licence check (Lemon Squeezy License API). Same contract as Quotanest.
- `scripts/build.js`: writes `sitemap.xml` and `robots.txt`, and with `--dist` copies the public files to `dist/`.
- `test/`: `core.test.js` (detection, switches, custom rules, redact, restore), `vault.test.js` (session backup), `license.test.js`.

## Tests and build

```sh
cd shadepad
node --test test/*.test.js
node scripts/build.js --dist
```

## Deploy

`.github/workflows/deploy-cloudflare.yml` tests, builds and deploys this folder to a Cloudflare Pages project named `shadepad` on pushes to `main`. The project must exist first (Cloudflare dashboard → Workers & Pages → Create → Pages → Direct Upload, name `shadepad`). Then set these variables on the project (Settings → Variables and Secrets):

- `LEMONSQUEEZY_PRODUCT_ID`: pins licence keys to this product.
- `LEMONSQUEEZY_DISABLED`: set to `1` to answer `configured: false`, which keeps the app open (the state before the product is on sale).

Before launch, set `checkoutUrl` in `config.js` to the Lemon Squeezy checkout link and `price` to the one-time price, then push.

## Behaviour when not on sale

If the server answers `configured: false`, the app opens without a key. If licensing is configured, the app shows the unlock screen, and a valid active key unlocks it on that device only.

## Known limits

- Detection is pattern based. It can miss secrets in unusual formats and can flag harmless numbers, so the output must be checked before sharing.
- Restore works only in the same page session, unless an encrypted session backup is opened. Reloading clears the originals.
- Custom rules are literal text, so they cannot cause catastrophic regex backtracking. Built-in patterns are unchanged.
- Switches and custom rules are not saved between reloads, by design (only the language and licence key are stored).
- Names are not detected (a person's name is not a pattern), and free text such as addresses is not detected.
- Turning off a category can let its text be picked up by another category (for example digits found as a phone number when card numbers are off).

## 배포 전 검증

설치·빌드·브라우저 검사·Cloudflare 배포 파일 구성은 [PREDEPLOY.md](PREDEPLOY.md)를 참고하세요. `codex/predeploy-2026-11-06` 브랜치의 검증 워크플로에는 배포 단계가 없습니다.
