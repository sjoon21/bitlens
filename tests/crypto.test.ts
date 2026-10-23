// Vectors marked "SDK" come from Bitwarden's own SDK tests (bitwarden/sdk-internal,
// crates/bitwarden-crypto: keys/master_key.rs, keys/utils.rs, enc_string/symmetric.rs).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkKdf,
  decryptEncString,
  decryptEncText,
  fromB64,
  makeMasterKey,
  stretchKey,
  toB64,
  unwrapUserKey,
} from "../src/core/crypto.ts";
import { encryptSym, keyBytes, randomKey } from "./helpers.ts";

const TE = new TextEncoder();

// Bitwarden's server auth hash: PBKDF2-SHA256(masterKey, salt = password, 1 iteration).
async function masterPasswordHash(masterKey: Uint8Array<ArrayBuffer>, password: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", masterKey, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: TE.encode(password), iterations: 1 }, k, 256);
  return toB64(new Uint8Array(bits));
}

test("SDK: PBKDF2 master key, with the email trimmed and lowercased", async () => {
  for (const email of ["test@bitwarden.com", "TEST@bitwarden.com", " test@bitwarden.com"]) {
    const mk = await makeMasterKey("asdfasdf", email, { type: 0, iterations: 100_000, memory: 0, parallelism: 0 });
    assert.equal(await masterPasswordHash(mk, "asdfasdf"), "wmyadRMyBZOH7P/a/ucTCbSghKgdzDpPqUnu/DAVtSw=", email);
  }
});

test("SDK: Argon2id master key (memory given in MiB, salt = SHA-256(email))", async () => {
  const mk = await makeMasterKey("asdfasdf", "test_salt", { type: 1, iterations: 4, memory: 32, parallelism: 2 });
  assert.equal(await masterPasswordHash(mk, "asdfasdf"), "PR6UjYmjmppTYcdyTiNbAhPJuQQOmynKbdEl1oyi/iQ=");
});

test("SDK: HKDF stretching of the master key", () => {
  const mk = Uint8Array.from([31, 79, 104, 226, 150, 71, 177, 90, 194, 80, 172, 209, 17, 129, 132, 81, 138, 167, 69, 167, 254, 149, 2, 27, 39, 197, 64, 42, 22, 195, 86, 75]);
  const s = stretchKey(mk);
  assert.deepEqual([...s.enc], [111, 31, 178, 45, 238, 152, 37, 114, 143, 215, 124, 83, 135, 173, 195, 23, 142, 134, 120, 249, 61, 132, 163, 182, 113, 197, 189, 204, 188, 21, 237, 96]);
  assert.deepEqual([...s.mac], [221, 127, 206, 234, 101, 27, 202, 38, 86, 52, 34, 28, 78, 28, 185, 16, 48, 61, 127, 166, 209, 247, 194, 87, 232, 26, 48, 85, 193, 249, 179, 155]);
});

test("SDK: legacy account, PBKDF2 600k + type 0 protected user key, end to end", async () => {
  const mk = await makeMasterKey("asdfasdfasdf", "legacy@bitwarden.com", { type: 0, iterations: 600_000, memory: 0, parallelism: 0 });
  const uk = await unwrapUserKey("0.8UClLa8IPE1iZT7chy5wzQ==|6PVfHnVk5S3XqEtQemnM5yb4JodxmPkkWzmDRdfyHtjORmvxqlLX40tBJZ+CKxQWmS8tpEB5w39rbgHg/gqs0haGdZG4cPbywsgGzxZ7uNI=", mk);
  assert.deepEqual([...uk.enc], [12, 95, 151, 203, 37, 4, 236, 67, 137, 97, 90, 58, 6, 127, 242, 28, 209, 168, 125, 29, 118, 24, 213, 44, 117, 202, 2, 115, 132, 165, 125, 148]);
  assert.deepEqual([...uk.mac], [186, 215, 234, 137, 24, 169, 227, 29, 218, 57, 180, 237, 73, 91, 189, 51, 253, 26, 17, 52, 226, 4, 134, 75, 194, 208, 178, 133, 128, 224, 140, 167]);
});

test("SDK: type 0 user key under a raw 32-byte master key", async () => {
  const mk = fromB64("hvBMMb1t79YssFZkpetYsM3deyVuQv4r88Uj9gvYe08=");
  const uk = await unwrapUserKey("0.tn/heK4HLbbEe+yEkC+kvw==|8QM94f7aVTtjm/bmvRdVxOxiLiiZtHYYO7+oBdjFCkilncesx0iVrXPl+tMKqW+Jo7+FtZdPNsTrL6RdoG7i5QbCRVwK+9010+xm7MTQY8s=", mk);
  assert.deepEqual([...uk.enc], [116, 170, 187, 43, 80, 212, 193, 202, 234, 181, 57, 66, 151, 249, 59, 47, 70, 16, 57, 4, 170, 78, 85, 241, 152, 232, 91, 57, 9, 87, 209, 245]);
  assert.deepEqual([...uk.mac], [40, 245, 106, 140, 2, 225, 138, 213, 98, 223, 92, 168, 135, 208, 22, 194, 31, 21, 178, 252, 203, 198, 35, 174, 53, 218, 254, 151, 235, 57, 7, 98]);
});

test("SDK: a MAC-stripped (type 0) EncString is rejected as a downgrade", async () => {
  const raw = fromB64("hvBMMb1t79YssFZkpetYsM3deyVuQv4r88Uj9gvYe0+G8EwxvW3v1iywVmSl61iwzd17JW5C/ivzxSP2C9h7Tw==");
  const key = { enc: raw.slice(0, 32), mac: raw.slice(32) };
  await assert.rejects(decryptEncString("0.NQfjHLr6za7VQVAbrpL81w==|wfrjmyJ0bfwkQlySrhw8dA==", key), /MAC_REQUIRED/);
});

test("decryptEncString round-trips type 2 and rejects tampering or unknown types", async () => {
  const key = randomKey();
  const enc = await encryptSym("sk-test-123", key);
  assert.equal(await decryptEncText(enc, key), "sk-test-123");
  assert.equal(await decryptEncText("", key), "");
  const tampered = enc.slice(0, -4) + (enc.endsWith("AAA=") ? "BBB=" : "AAA=");
  await assert.rejects(decryptEncString(tampered, key), /MAC_FAILED/);
  await assert.rejects(decryptEncString("7.AAAA", key), /UNSUPPORTED_ENC_TYPE_7/);
  await assert.rejects(decryptEncString("2.AAAA|AAAA", key), /MALFORMED_ENC_STRING/);
});

test("unlock chain: the right password unwraps the user key, a wrong one fails with MAC_FAILED", async () => {
  const kdf = { type: 0, iterations: 1000, memory: 0, parallelism: 0 };
  const userKey = randomKey();
  const protectedKey = await encryptSym(keyBytes(userKey), stretchKey(await makeMasterKey("correct horse", "u@x.io", kdf)));
  assert.deepEqual(await unwrapUserKey(protectedKey, await makeMasterKey("correct horse", "U@X.io ", kdf)), userKey);
  await assert.rejects(unwrapUserKey(protectedKey, await makeMasterKey("wrong", "u@x.io", kdf)), /MAC_FAILED/);
});

test("a wrong password on a legacy type 0 user key also reports MAC_FAILED", async () => {
  const mk = await makeMasterKey("wrong", "legacy@bitwarden.com", { type: 0, iterations: 1000, memory: 0, parallelism: 0 });
  await assert.rejects(
    unwrapUserKey("0.8UClLa8IPE1iZT7chy5wzQ==|6PVfHnVk5S3XqEtQemnM5yb4JodxmPkkWzmDRdfyHtjORmvxqlLX40tBJZ+CKxQWmS8tpEB5w39rbgHg/gqs0haGdZG4cPbywsgGzxZ7uNI=", mk),
    /MAC_FAILED/,
  );
});

test("checkKdf accepts Bitwarden's ranges and rejects what a hostile server could send", () => {
  assert.deepEqual(checkKdf({ type: 0, iterations: 600_000, memory: 0, parallelism: 0 }).iterations, 600_000);
  assert.equal(checkKdf({ type: 1, iterations: 3, memory: 64, parallelism: 4 }).memory, 64);
  for (const bad of [
    { type: 2, iterations: 600_000, memory: 0, parallelism: 0 },
    { type: 0, iterations: 10, memory: 0, parallelism: 0 },
    { type: 0, iterations: 1e9, memory: 0, parallelism: 0 },
    { type: 1, iterations: 3, memory: 1_000_000, parallelism: 4 },
    { type: 1, iterations: 3, memory: 64, parallelism: 64 },
    { type: 1, iterations: 1.5, memory: 64, parallelism: 4 },
  ]) {
    assert.throws(() => checkKdf(bad), /BAD_KDF/, JSON.stringify(bad));
  }
});

test("a 32-byte legacy user key is reported as unsupported, not as a wrong password", async () => {
  const mk = fromB64("hvBMMb1t79YssFZkpetYsM3deyVuQv4r88Uj9gvYe08=");
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aes = await crypto.subtle.importKey("raw", mk, "AES-CBC", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, aes, new Uint8Array(32)));
  await assert.rejects(unwrapUserKey(`0.${toB64(iv)}|${toB64(ct)}`, mk), /LEGACY_KEY_UNSUPPORTED/);
});
