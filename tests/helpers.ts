// Test-only encryption helper producing Bitwarden type 2 (AES-CBC-256 + HMAC-SHA256) EncStrings.

import { toB64 } from "../src/core/crypto.ts";
import type { Bytes, SymKey } from "../src/types.ts";

const TE = new TextEncoder();

export function randomKey(): SymKey {
  return { enc: crypto.getRandomValues(new Uint8Array(32)), mac: crypto.getRandomValues(new Uint8Array(32)) };
}

export function keyBytes(k: SymKey): Bytes {
  const out = new Uint8Array(64);
  out.set(k.enc, 0);
  out.set(k.mac, 32);
  return out;
}

export async function encryptSym(data: Bytes | string, key: SymKey): Promise<string> {
  const plain = typeof data === "string" ? TE.encode(data) : data;
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aes = await crypto.subtle.importKey("raw", key.enc, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aes, plain));
  const hk = await crypto.subtle.importKey("raw", key.mac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const msg = new Uint8Array(iv.length + ct.length);
  msg.set(iv, 0);
  msg.set(ct, iv.length);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", hk, msg));
  return `2.${toB64(iv)}|${toB64(ct)}|${toB64(mac)}`;
}

export function base32Encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
