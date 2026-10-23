// Bitwarden client-side crypto, written from Bitwarden's published security model (EncString
// format, master key derivation, HKDF key stretching) and checked against test vectors from
// Bitwarden's own SDK (tests/crypto.test.ts).

import { expand } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Bytes, KdfConfig, SymKey } from "../types.ts";
import { argon2, type Argon2Params } from "./argon2.ts";

const utf8 = new TextEncoder();
const textDecoder = new TextDecoder();

// Bitwarden EncryptionType values this plugin understands
const ENC = { AesCbc256: 0, AesCbc256HmacSha256: 2, Rsa2048OaepSha256: 3, Rsa2048OaepSha1: 4 } as const;
const KDF_PBKDF2 = 0;
const KDF_ARGON2ID = 1;

export function fromB64(s: string): Bytes {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function concat(a: Uint8Array, b: Uint8Array): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.reduce((diff, x, i) => diff | (x ^ b[i]), 0) === 0;
}

interface EncString {
  type: number;
  parts: Bytes[];
}

// "<type>.<b64>|<b64>[|<b64>]". Headerless strings are legacy: 3 parts meant AES-128 (unsupported).
function parseEncString(s: string): EncString {
  const dot = s.indexOf(".");
  const body = dot === -1 ? s : s.slice(dot + 1);
  const pieces = body.split("|");
  const type = dot === -1 ? (pieces.length === 3 ? 1 : ENC.AesCbc256) : Number(s.slice(0, dot));
  return { type, parts: pieces.map(fromB64) };
}

async function aesCbcDecrypt(key: Bytes, iv: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, k, data));
}

// Only authenticated AES-CBC-HMAC data is accepted, as in the official SDK: MAC-less (type 0)
// data under a key is treated as a downgrade attempt.
export async function decryptEncString(s: string, key: SymKey): Promise<Bytes> {
  const { type, parts } = parseEncString(s);
  if (type === ENC.AesCbc256) throw new Error("MAC_REQUIRED");
  if (type !== ENC.AesCbc256HmacSha256) throw new Error(`UNSUPPORTED_ENC_TYPE_${type}`);
  const [iv, data, mac] = parts;
  if (!iv || !data || !mac) throw new Error("MALFORMED_ENC_STRING");
  if (!constantTimeEqual(hmac(sha256, key.mac, concat(iv, data)), mac)) throw new Error("MAC_FAILED");
  return aesCbcDecrypt(key.enc, iv, data);
}

export async function decryptEncText(s: string | null | undefined, key: SymKey): Promise<string> {
  return s ? textDecoder.decode(await decryptEncString(s, key)) : "";
}

// Consumes `raw`: the decrypted 64-byte buffer is wiped once split into its halves.
export function splitKey(raw: Bytes): SymKey {
  try {
    if (raw.length !== 64) throw new Error(`BAD_KEY_LENGTH_${raw.length}`);
    return { enc: raw.slice(0, 32), mac: raw.slice(32) };
  } finally {
    raw.fill(0);
  }
}

// Best effort: JS can't guarantee no copies remain, but don't leave key bytes around on purpose.
export function wipeKey(key: SymKey): void {
  key.enc.fill(0);
  key.mac.fill(0);
}

// HKDF-Expand (no extract step) of the master key into an enc/mac pair.
export function stretchKey(masterKey: Bytes): SymKey {
  const derive = (info: string) => expand(sha256, masterKey, utf8.encode(info), 32) as Bytes;
  return { enc: derive("enc"), mac: derive("mac") };
}

// The protected user key is type 2 under the stretched master key; legacy accounts used type 0
// under the raw master key. Throws MAC_FAILED for a wrong master password either way.
export async function unwrapUserKey(protectedKey: string, masterKey: Bytes): Promise<SymKey> {
  const { type, parts } = parseEncString(protectedKey);
  if (type === ENC.AesCbc256) {
    let raw: Bytes;
    try {
      raw = await aesCbcDecrypt(masterKey, parts[0], parts[1]);
    } catch {
      throw new Error("MAC_FAILED"); // no MAC on legacy keys: bad padding means a wrong password
    }
    if (raw.length === 32) {
      raw.fill(0);
      throw new Error("LEGACY_KEY_UNSUPPORTED"); // enc-only user key, like the official SDK no longer supports
    }
    return splitKey(raw);
  }
  const stretched = stretchKey(masterKey);
  try {
    return splitKey(await decryptEncString(protectedKey, stretched));
  } finally {
    wipeKey(stretched);
  }
}

export async function unwrapOrgKey(s: string, privateKeyPkcs8: Bytes): Promise<SymKey> {
  const { type, parts } = parseEncString(s);
  const hash = { [ENC.Rsa2048OaepSha256]: "SHA-256", [ENC.Rsa2048OaepSha1]: "SHA-1" }[type];
  if (!hash) throw new Error(`UNSUPPORTED_ENC_TYPE_${type}`);
  const k = await crypto.subtle.importKey("pkcs8", privateKeyPkcs8, { name: "RSA-OAEP", hash }, false, ["decrypt"]);
  return splitKey(new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, k, parts[0])));
}

// Ranges Bitwarden itself allows. The server picks these values, so bound them before running a
// KDF: a hostile self-hosted server could otherwise ask for terabytes of Argon2 memory.
const KDF_LIMITS = {
  pbkdf2Iterations: [5_000, 2_000_000],
  argon2Iterations: [2, 10],
  argon2MemoryMiB: [15, 1024],
  argon2Parallelism: [1, 16],
} as const;

function inRange(v: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(v) && v >= min && v <= max;
}

export function checkKdf(k: KdfConfig): KdfConfig {
  const ok = k.type === KDF_ARGON2ID
    ? inRange(k.iterations, KDF_LIMITS.argon2Iterations) && inRange(k.memory, KDF_LIMITS.argon2MemoryMiB) && inRange(k.parallelism, KDF_LIMITS.argon2Parallelism)
    : k.type === KDF_PBKDF2 && inRange(k.iterations, KDF_LIMITS.pbkdf2Iterations);
  if (!ok) throw new Error("BAD_KDF");
  return k;
}

export type Argon2Fn = (password: Uint8Array, salt: Uint8Array, params: Argon2Params) => Promise<Bytes>;

const argon2OnThisThread: Argon2Fn = async (password, salt, params) => argon2(password, salt, params);

// PBKDF2-SHA256(password, email) or Argon2id(password, SHA-256(email)); the email is trimmed and lowercased.
export async function makeMasterKey(
  password: string,
  email: string,
  kdf: KdfConfig,
  argon2Impl: Argon2Fn = argon2OnThisThread,
): Promise<Bytes> {
  const pw = utf8.encode(password);
  const salt = utf8.encode(email.trim().toLowerCase());
  try {
    if (kdf.type === KDF_ARGON2ID) {
      const params = { iterations: kdf.iterations, memoryKiB: kdf.memory * 1024, parallelism: kdf.parallelism };
      return await argon2Impl(pw, sha256(salt), params);
    }
    const base = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: kdf.iterations }, base, 256);
    return new Uint8Array(bits);
  } finally {
    pw.fill(0);
  }
}
