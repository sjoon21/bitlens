export type Region = "us" | "eu" | "self";

// Everything here is written to data.json, which may be synced or committed.
// Never add secrets: the API client_secret lives in app.secretStorage and only its id is stored.
export interface BitwardenPluginSettings {
  region: Region;
  serverUrl: string; // base URL when region === "self"
  email: string;
  clientId: string; // personal API key client_id (user.xxxx)
  clientSecretId: string; // SecretStorage id of the personal API key client_secret
  deviceId: string; // generated UUID
  autoLockMinutes: number; // 0 = disabled
}

export const DEFAULT_SETTINGS: BitwardenPluginSettings = {
  region: "us",
  serverUrl: "",
  email: "",
  clientId: "",
  clientSecretId: "",
  deviceId: "",
  autoLockMinutes: 15,
};

export type Bytes = Uint8Array<ArrayBuffer>;

// AES-256-CBC + HMAC-SHA256 key pair. Enc-only (legacy) keys are not supported, matching the official SDK.
export interface SymKey {
  enc: Bytes;
  mac: Bytes;
}

export interface KdfConfig {
  type: number; // 0 = PBKDF2-SHA256, 1 = Argon2id
  iterations: number;
  memory: number; // MiB (Argon2id)
  parallelism: number; // Argon2id
}

// const objects instead of enums so tests can run under Node's type stripping
export const CipherType = { Login: 1, SecureNote: 2, Card: 3, Identity: 4, SshKey: 5 } as const;
export type CipherType = (typeof CipherType)[keyof typeof CipherType];

export const FieldType = { Text: 0, Hidden: 1, Boolean: 2, Linked: 3 } as const;
export type FieldType = (typeof FieldType)[keyof typeof FieldType];

export interface VaultField {
  name: string;
  type: FieldType;
  value?: string | boolean;
  linkedId?: number;
}

export interface VaultItem {
  id: string;
  type: CipherType;
  favorite: boolean;
  folderId: string | null;
  name: string;
  notes?: string;
  login?: {
    username: string;
    password: string;
    totp: string | null;
    uris: { uri: string }[];
  };
  card?: {
    cardholderName: string;
    number: string;
    expMonth: string;
    expYear: string;
    code: string;
    brand: string;
  };
  sshKey?: {
    privateKey: string;
    publicKey: string;
    keyFingerprint: string;
  };
  fields?: VaultField[];
}

export interface VaultFolder {
  id: string;
  name: string;
}

export interface Vault {
  items: VaultItem[];
  folders: VaultFolder[];
  failed: number; // ciphers that could not be decrypted
}
