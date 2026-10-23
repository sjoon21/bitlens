# BitLens (Obsidian plugin)

Obsidian plugin that unlocks a Bitwarden vault client-side and (planned) renders `{{bw:Item:field}}` references in notes as masked widgets, so secrets never land in Markdown or `data.json`.

## Commands

- `npm run build`: `tsc` type check + esbuild production bundle → `main.js`
- `npm run dev`: esbuild watch
- `npm test`: `node:test` via Node type stripping (`tests/*.test.ts`), no test framework
- Manual test: copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/bitlens/` (folder name = manifest `id`)
- Release: push a tag equal to `manifest.json` version (no `v`); `.github/workflows/release.yml` builds and attaches the assets to a draft release. Keep `versions.json` in sync

## Layout

- `src/core/`: no UI. `crypto.ts` (EncString, master key, HKDF stretch, user/org key unwrap), `argon2.ts` (@noble/hashes wrapper, also run in a Web Worker), `totp.ts`, `wire.ts` (API response types + PascalCase→camelCase), `vault.ts` (/sync → decrypted `Vault`), `api.ts` (Identity/API client), `session.ts` (in-memory lock state)
- `src/editor/`: `{{bw:...}}` support. `secret-ref.ts` and `insert-entries.ts` are pure (parse/resolve, insert choices); `secret-widget.ts` is the shared inline widget used by `reading-view.ts` (post-processor) and `live-preview.ts` (CM6); `ref-suggest.ts` autocompletes after `{{bw:`
- `src/ui/`: Obsidian modals (unlock, insert picker), settings tab, sidebar `vault-view.ts` (+ pure `vault-groups.ts`), shared copy/reveal helpers `secret-actions.ts`
- `src/main.ts`: wiring (commands, status bar, auto-lock)
- `project.md`: spec and roadmap (Phase 1 to 5). Local only, gitignored

## Security invariants (do not break)

- `data.json` holds only non-sensitive settings. Master password, master/user keys, access token and the decrypted vault live only in memory (`Session`, `BitwardenApi`).
- The API `client_secret` lives in `app.secretStorage`; settings store only its id (`clientSecretId`). Verified: Obsidian keeps it in app localStorage encrypted with Electron safeStorage (OS keychain), device-local, never in the vault folder, so each device needs it entered once.
- `decryptEncString` accepts only type 2 (AES-CBC + HMAC), like the official SDK; type 0 is allowed only when unwrapping a legacy user key with the master key. Don't relax it. Keys are always enc+mac pairs (`SymKey`).
- `Session.lock()` bumps `generation`; async work must check it before publishing results.
- Never `console.log` secrets or vault content.
- Secret widgets resolve values at click time from the session; never capture a secret at render time.
- Every request sends `Bitwarden-Client-Version` (`CLIENT_HEADERS` in `api.ts`). Without it the identity server rejects login (`version_header_missing`). Keep it below `2025.11.0` until v2 (COSE) decryption is implemented: that version is the server's gate for v2-encryption accounts.

## Conventions

- Never put "Bitwarden" in the plugin's name, id or repo name: Bitwarden's trademark policy forbids using the mark in a product name. Describing compatibility ("works with Bitwarden") in text is fine; README keeps the ® on first mention and the trademark notice at the bottom.
- Never copy code from other Obsidian plugins: the Obsidian developer policy forbids inheriting code from another directory plugin without its author's public permission. Implement from Bitwarden's protocol and SDK instead.
- Anything imported by tests must be Node-strippable TypeScript: no `enum`, no `namespace`, no constructor parameter properties. Use `as const` objects.
- Relative imports use explicit `.ts` extensions (`allowImportingTsExtensions`; esbuild resolves them).
- `src/core/` must not import `obsidian` except `api.ts` (uses `requestUrl` to avoid CORS); keep the rest unit-testable.
- `obsidian` types are pinned to `minAppVersion` (1.11.4) so newer APIs fail type checking. Bump both together.
- Crypto changes must keep passing the Bitwarden SDK vectors in `tests/crypto.test.ts`; add a vector from `bitwarden/sdk-internal` rather than a self-made one when covering new crypto.
- `isDesktopOnly: true` because the clipboard auto-clear uses Electron's clipboard. Supporting mobile means dropping that or guarding it and testing on devices first.
- Web Workers: `import src from "./x.worker.ts?worker"` inlines a separately bundled worker as a string (esbuild plugin in `esbuild.config.mjs`).
- UI strings are English. Commit messages: `<type>: <Korean description>`.
