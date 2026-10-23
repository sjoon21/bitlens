// Maps internal error codes to messages a user can act on.
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "MAC_FAILED") return "Wrong master password.";
  if (msg === "NOT_CONFIGURED") return "Bitwarden is not configured. Fill in the plugin settings first.";
  if (/^LOGIN_FAILED_\d+: invalid_client_version\b/.test(msg)) {
    return "This account uses Bitwarden's newer encryption (v2), which this plugin does not support yet.";
  }
  const rejected =/^LOGIN_FAILED_(?:400|401)(?:: (.+))?$/.exec(msg);
  if (rejected) {
    const reason = rejected[1] ? ` (${rejected[1]})` : "";
    return `The API key was rejected${reason}. Check client_id and client_secret.`;
  }
  if (msg === "LOCKED") return "The vault is locked.";
  if (msg === "BAD_KDF") return "The server returned key derivation settings outside Bitwarden's allowed ranges. Unlock was refused.";
  if (msg === "LEGACY_KEY_UNSUPPORTED") return "This account uses Bitwarden's legacy encryption key, which is not supported. Rotating your account encryption key in the Bitwarden web vault fixes this.";
  if (/^(PRELOGIN|LOGIN|SYNC)_FAILED/.test(msg)) return `Bitwarden server error (${msg}).`;
  return `Unexpected error: ${msg}`;
}
