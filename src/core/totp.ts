// TOTP (RFC 6238) for Bitwarden's authenticator keys: a bare base32 secret or an otpauth:// URI.

import type { Bytes } from "../types.ts";

export interface TotpParams {
  secret: string; // base32
  digits: number;
  period: number; // seconds
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
}

const ALGORITHMS: Record<string, TotpParams["algorithm"]> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Like Bitwarden's own clients, anything outside the base32 alphabet (spaces, dashes, padding,
// stray punctuation) is ignored.
function decodeBase32(s: string): Bytes {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s.toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) continue;
    acc = ((acc << 5) | v) & 0xfff; // only the newest <= 12 bits are ever needed
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function parseTotp(value: string | null | undefined): TotpParams | null {
  if (!value || value.startsWith("steam://")) return null; // Steam Guard codes use a different alphabet
  let secret = value;
  let digits = 6;
  let period = 30;
  let algorithm = "SHA1";
  if (value.startsWith("otpauth://")) {
    let q: URLSearchParams;
    try {
      q = new URL(value).searchParams;
    } catch {
      return null;
    }
    secret = q.get("secret") ?? "";
    digits = Number(q.get("digits") ?? 6);
    period = Number(q.get("period") ?? 30);
    algorithm = (q.get("algorithm") ?? "SHA1").toUpperCase();
  }
  const valid = ALGORITHMS[algorithm] && decodeBase32(secret).length && Number.isInteger(digits) && digits >= 1 && digits <= 10 && Number.isInteger(period) && period > 0;
  return valid ? { secret, digits, period, algorithm: ALGORITHMS[algorithm] } : null;
}

export async function totpCode(p: TotpParams, now = Date.now()): Promise<string> {
  const keyBytes = decodeBase32(p.secret);
  if (!keyBytes.length) throw new Error("Invalid TOTP secret");
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(Math.floor(now / 1000 / p.period)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: p.algorithm }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const truncated = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
  return String(truncated % 10 ** p.digits).padStart(p.digits, "0");
}

// Whole seconds left in the current window (period..1).
export function totpSecondsLeft(period: number, now = Date.now()): number {
  return period - (Math.floor(now / 1000) % period);
}
