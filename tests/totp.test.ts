import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTotp, totpCode, totpSecondsLeft, type TotpParams } from "../src/core/totp.ts";
import { base32Encode } from "./helpers.ts";

const TE = new TextEncoder();

// RFC 6238 Appendix B (8 digits, 30s step)
const SEEDS = {
  "SHA-1": "12345678901234567890",
  "SHA-256": "12345678901234567890123456789012",
  "SHA-512": "1234567890123456789012345678901234567890123456789012345678901234",
} as const;
const RFC6238: [number, Record<keyof typeof SEEDS, string>][] = [
  [59, { "SHA-1": "94287082", "SHA-256": "46119246", "SHA-512": "90693936" }],
  [1111111109, { "SHA-1": "07081804", "SHA-256": "68084774", "SHA-512": "25091201" }],
  [1234567890, { "SHA-1": "89005924", "SHA-256": "91819424", "SHA-512": "93441116" }],
  [20000000000, { "SHA-1": "65353130", "SHA-256": "77737706", "SHA-512": "47863826" }],
];

test("totpCode matches RFC 6238 vectors for SHA-1/256/512", async () => {
  for (const [t, codes] of RFC6238) {
    for (const algorithm of Object.keys(SEEDS) as (keyof typeof SEEDS)[]) {
      const p: TotpParams = { secret: base32Encode(TE.encode(SEEDS[algorithm])), digits: 8, period: 30, algorithm };
      assert.equal(await totpCode(p, t * 1000), codes[algorithm], `${algorithm} t=${t}`);
    }
  }
});

test("base32 secrets tolerate lowercase, spaces, padding and stray characters, like Bitwarden", async () => {
  const canonical = await totpCode(parseTotp("JBSWY3DPEHPK3PXP")!, 59_000);
  assert.equal(await totpCode(parseTotp("jbsw y3dp ehpk 3pxp")!, 59_000), canonical);
  assert.equal(await totpCode(parseTotp("JBSWY3DPEHPK3PXP====")!, 59_000), canonical);
  assert.equal(await totpCode(parseTotp("JBSWY3DP.EHPK3PXP_")!, 59_000), canonical);
});

test("parseTotp handles bare secrets and otpauth URIs, and rejects unusable ones", () => {
  assert.deepEqual(parseTotp("JBSWY3DPEHPK3PXP"), { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA-1" });
  assert.deepEqual(
    parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8&period=60&algorithm=sha256"),
    { secret: "JBSWY3DPEHPK3PXP", digits: 8, period: 60, algorithm: "SHA-256" },
  );
  assert.equal(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5"), null);
  assert.equal(parseTotp("otpauth://totp/x?digits=6"), null);
  assert.equal(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=Infinity"), null);
  assert.equal(parseTotp("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=1.5"), null);
  assert.equal(parseTotp("steam://ABCDE"), null);
  assert.equal(parseTotp("-"), null);
  assert.equal(parseTotp(""), null);
});

test("totpSecondsLeft counts down within each window", () => {
  assert.equal(totpSecondsLeft(30, 0), 30);
  assert.equal(totpSecondsLeft(30, 1_000), 29);
  assert.equal(totpSecondsLeft(30, 29_999), 1);
  assert.equal(totpSecondsLeft(30, 30_000), 30);
});
