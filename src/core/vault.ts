// Decrypts a /sync response into plain vault items. Pure: no Obsidian or network access.

import type { SymKey, Vault, VaultField, VaultItem } from "../types.ts";
import { CipherType, FieldType } from "../types.ts";
import { decryptEncString, decryptEncText, splitKey, unwrapOrgKey, wipeKey } from "./crypto.ts";
import { camelize, type RawCipher, type RawProfile, type RawSync } from "./wire.ts";

type Text = (s: string | null | undefined) => Promise<string>;

const CARD_FIELDS = ["cardholderName", "number", "expMonth", "expYear", "code", "brand"] as const;
const SSH_FIELDS = ["privateKey", "publicKey", "keyFingerprint"] as const;

async function decryptAll<K extends string>(obj: Partial<Record<K, string | null>>, keys: readonly K[], text: Text): Promise<Record<K, string>> {
  const values = await Promise.all(keys.map((k) => text(obj[k])));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<K, string>;
}

// Field values are EncStrings for every type, booleans included ("true"/"false").
async function decryptField(f: NonNullable<RawCipher["fields"]>[number], text: Text): Promise<VaultField> {
  const name = await text(f.name);
  const type = f.type as FieldType;
  if (type === FieldType.Linked) return { name, type, linkedId: f.linkedId ?? undefined };
  const value = await text(f.value);
  return { name, type, value: type === FieldType.Boolean ? value === "true" : value };
}

async function decryptCipher(c: RawCipher, key: SymKey): Promise<VaultItem> {
  const text: Text = (s) => decryptEncText(s, key);
  const login = c.type === CipherType.Login ? c.login : null;
  const card = c.type === CipherType.Card ? c.card : null;
  const sshKey = c.type === CipherType.SshKey ? c.sshKey : null;
  return {
    id: c.id,
    type: c.type as CipherType,
    favorite: !!c.favorite,
    folderId: c.folderId ?? null,
    name: await text(c.name),
    ...(c.notes ? { notes: await text(c.notes) } : {}),
    ...(login ? {
      login: {
        username: await text(login.username),
        password: await text(login.password),
        totp: login.totp ? await text(login.totp) : null,
        uris: await Promise.all((login.uris ?? []).map(async (u) => ({ uri: await text(u.uri) }))),
      },
    } : {}),
    ...(card ? { card: await decryptAll(card, CARD_FIELDS, text) } : {}),
    ...(sshKey ? { sshKey: await decryptAll(sshKey, SSH_FIELDS, text) } : {}),
    ...(c.fields?.length ? { fields: await Promise.all(c.fields.map((f) => decryptField(f, text))) } : {}),
  };
}

// Org ciphers use their org's key; a cipher with its own key ("cipher key encryption")
// carries it wrapped by that user/org key.
async function decryptWithItsKey(c: RawCipher, userKey: SymKey, orgKeys: Map<string, SymKey>): Promise<VaultItem> {
  const outer = c.organizationId ? orgKeys.get(c.organizationId) : userKey;
  if (!outer) throw new Error("MISSING_ORG_KEY");
  if (!c.key) return decryptCipher(c, outer);
  const own = splitKey(await decryptEncString(c.key, outer));
  try {
    return await decryptCipher(c, own);
  } finally {
    wipeKey(own);
  }
}

async function unwrapOrgKeys(profile: RawProfile | undefined, userKey: SymKey): Promise<Map<string, SymKey>> {
  const keys = new Map<string, SymKey>();
  const orgs = (profile?.organizations ?? []).filter((o) => o.id && o.key);
  if (!orgs.length || !profile?.privateKey) return keys;
  const pkcs8 = await decryptEncString(profile.privateKey, userKey);
  try {
    for (const o of orgs) {
      try {
        keys.set(o.id!, await unwrapOrgKey(o.key!, pkcs8));
      } catch {
        // an org key we can't unwrap: that org's ciphers are counted as failed
      }
    }
  } finally {
    pkcs8.fill(0);
  }
  return keys;
}

export async function decryptVault(raw: unknown, userKey: SymKey): Promise<Vault> {
  const sync = camelize<RawSync>(raw);
  const orgKeys = await unwrapOrgKeys(sync.profile, userKey);
  try {
    const live = (sync.ciphers ?? []).filter((c) => !c.deletedDate);
    const settled = await Promise.allSettled(live.map((c) => decryptWithItsKey(c, userKey, orgKeys)));
    const items = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const folders = await Promise.all(
      (sync.folders ?? []).filter((f) => f.id).map(async (f) => ({ id: f.id!, name: await decryptEncText(f.name, userKey) })),
    );
    return { items, folders, failed: settled.length - items.length };
  } finally {
    orgKeys.forEach(wipeKey);
  }
}

// Only the profile is normalized here; the full sync payload can be large.
export function protectedUserKey(raw: unknown): string {
  const r = raw as { profile?: unknown; Profile?: unknown } | null;
  const key = camelize<RawProfile | undefined>(r?.profile ?? r?.Profile)?.key;
  if (!key) throw new Error("NO_USER_KEY");
  return key;
}
