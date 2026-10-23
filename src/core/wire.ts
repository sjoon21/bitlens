// Shapes of the Bitwarden API responses this plugin reads. Values marked Enc are EncStrings.

type Enc = string | null | undefined;

export interface RawProfile {
  key?: string;
  privateKey?: string;
  organizations?: { id?: string; key?: string }[];
}

export interface RawCipher {
  id: string;
  type: number;
  organizationId?: string | null;
  folderId?: string | null;
  favorite?: boolean;
  deletedDate?: string | null;
  key?: Enc;
  name?: Enc;
  notes?: Enc;
  login?: { username?: Enc; password?: Enc; totp?: Enc; uris?: { uri?: Enc }[] | null } | null;
  card?: { cardholderName?: Enc; number?: Enc; expMonth?: Enc; expYear?: Enc; code?: Enc; brand?: Enc } | null;
  sshKey?: { privateKey?: Enc; publicKey?: Enc; keyFingerprint?: Enc } | null;
  fields?: { type: number; name?: Enc; value?: Enc; linkedId?: number | null }[] | null;
}

export interface RawSync {
  profile?: RawProfile;
  folders?: { id?: string | null; name?: Enc }[];
  ciphers?: RawCipher[];
}

// bitwarden.com answers in camelCase; older servers and Vaultwarden may use PascalCase.
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelize(v)) as T;
  if (value === null || typeof value !== "object") return value as T;
  const entries = Object.entries(value).map(([k, v]) => [k && k[0].toLowerCase() + k.slice(1), camelize(v)]);
  return Object.fromEntries(entries) as T;
}
