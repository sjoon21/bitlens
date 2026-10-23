# BitLens

Keep API keys and passwords out of your Markdown. Write a reference like `{{bw:OpenAI}}` in a note; the secret stays in your Bitwarden® vault, and Obsidian shows it as a masked widget you can copy or reveal once the vault is unlocked.

Your notes can then be synced or pushed to Git without leaking credentials: the files only ever contain the reference.

> BitLens is an independent, unofficial plugin. It is not affiliated with or endorsed by Bitwarden, Inc.

## Features

- **Inline secrets**: `{{bw:...}}` renders as `🔑 OpenAI · apiKey •••••••• [copy] [show]` in Reading view and Live Preview. Edit the raw reference by moving the cursor into it.
- **Insert without typing the syntax**: run **Insert secret reference** to pick a single field or a whole item (all of its fields as a list), or type `{{bw:` for autocomplete.
- **Vault sidebar**: search, favorites and folders, per-field copy / reveal / insert, and live TOTP codes with a countdown.
- **Auto-lock** after a configurable idle time. The copied value is cleared from the clipboard after 30 seconds.

## Reference syntax

| Reference | Value |
| --- | --- |
| `{{bw:Item}}` | password |
| `{{bw:Item:username}}` | username |
| `{{bw:Item:password}}` | password |
| `{{bw:Item:totp}}` | current TOTP code |
| `{{bw:Item:notes}}` | notes |
| `{{bw:Item:field:Name}}` | custom field `Name` |

`Item` is the item's name in Bitwarden and must be unique. References inside code spans and code blocks are left as text, so you can document the syntax.

## Setup

1. In the Bitwarden web vault, open **Account settings → Security → Keys → View API key** and note `client_id` and `client_secret`.
2. In Obsidian, open **Settings → BitLens** and fill in the server (bitwarden.com, bitwarden.eu or self-hosted), email, `client_id` and `client_secret`.
3. Click **🔒 Bitwarden** in the status bar (or run **Unlock vault**) and enter your master password.

## Security model

- Your master password, the derived keys, the access token and the decrypted vault exist **only in memory**. Locking, the idle timer or quitting Obsidian discards them.
- `client_secret` is stored with Obsidian's secret storage, which keeps it outside the vault folder, encrypted by the operating system keychain. The plugin's `data.json` holds only non-sensitive settings (server, email, `client_id`, the secret's name, a device id, the auto-lock time).
- Decryption happens locally following Bitwarden's client protocol (PBKDF2 or Argon2id, HKDF, AES-256-CBC with HMAC-SHA256, RSA-OAEP for organization keys). Unauthenticated ciphertext is rejected, as in the official clients.
- Widgets resolve a secret at the moment you click copy or show; nothing is rendered into the page until you ask for it.
- No telemetry.

## Network use

This plugin requires a Bitwarden account. It only talks to the Bitwarden server you configure (`identity` and `api` endpoints of bitwarden.com, bitwarden.eu or your self-hosted server) to look up your key derivation settings, log in with your personal API key, and download your encrypted vault. Nothing else is sent anywhere.

## Limitations

- Read-only: create and edit items in Bitwarden itself.
- Desktop only for now.
- Accounts already migrated to Bitwarden's newer (v2) encryption are not supported yet; unlocking shows a clear error instead.
- In Reading view, an item name containing Markdown emphasis characters (`*`, `_`) is not recognized.
- The sidebar shows logins, notes and custom fields; card, identity and SSH key details are not displayed.

## Development

```bash
npm install
npm test        # unit tests, including Bitwarden SDK test vectors
npm run build   # type check + bundle to main.js
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/bitlens/` to try it.

## Acknowledgements

Argon2id and HKDF come from [@noble/hashes](https://github.com/paulmillr/noble-hashes).

## License

[MIT](LICENSE)

---

Bitwarden is a trademark or registered trademark of Bitwarden, Inc. in the United States and/or other countries.
