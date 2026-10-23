import { test } from "node:test";
import assert from "node:assert/strict";
import { toB64 } from "../src/core/crypto.ts";
import { decryptVault, protectedUserKey } from "../src/core/vault.ts";
import { CipherType, FieldType, type SymKey } from "../src/types.ts";
import { encryptSym, keyBytes, randomKey } from "./helpers.ts";

async function rsaOrgKey(orgKey: SymKey, userKey: SymKey) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-1" },
    true,
    ["encrypt", "decrypt"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, keyBytes(orgKey)));
  return { privateKey: await encryptSym(pkcs8, userKey), orgKey: `4.${toB64(wrapped)}` };
}

test("decryptVault handles user, org and per-cipher keys, PascalCase, trash and failures", async () => {
  const userKey = randomKey();
  const orgKey = randomKey();
  const cipherKey = randomKey();
  const rsa = await rsaOrgKey(orgKey, userKey);

  const sync = {
    profile: {
      key: "2.protected",
      privateKey: rsa.privateKey,
      organizations: [{ id: "org1", key: rsa.orgKey }],
    },
    folders: [{ id: null, name: null }, { id: "f1", name: await encryptSym("Infra", userKey) }],
    ciphers: [
      {
        id: "c1", type: CipherType.Login, folderId: "f1", favorite: true,
        name: await encryptSym("OpenAI", userKey),
        login: {
          username: await encryptSym("me@x.com", userKey),
          password: await encryptSym("pw1", userKey),
          totp: null,
          uris: [{ uri: await encryptSym("https://openai.com", userKey) }],
        },
        fields: [
          { type: FieldType.Hidden, name: await encryptSym("apiKey", userKey), value: await encryptSym("sk-123", userKey) },
          { type: FieldType.Boolean, name: await encryptSym("prod", userKey), value: await encryptSym("true", userKey) },
          { type: FieldType.Boolean, name: await encryptSym("beta", userKey), value: await encryptSym("false", userKey) },
        ],
      },
      // PascalCase (older servers / Vaultwarden) + org key
      {
        Id: "c2", Type: CipherType.SecureNote, OrganizationId: "org1",
        Name: await encryptSym("DB note", orgKey), Notes: await encryptSym("host=db", orgKey),
      },
      // cipher key encryption: item fields under its own key, wrapped by the user key
      {
        id: "c3", type: CipherType.Login, key: await encryptSym(keyBytes(cipherKey), userKey),
        name: await encryptSym("AWS", cipherKey),
        login: { password: await encryptSym("pw3", cipherKey) },
      },
      { id: "c4", type: CipherType.Login, deletedDate: "2026-01-01", name: await encryptSym("trashed", userKey) },
      { id: "c5", type: CipherType.Login, name: await encryptSym("wrong key", randomKey()) },
    ],
  };

  const vault = await decryptVault(sync, userKey);

  assert.equal(vault.failed, 1);
  assert.deepEqual(vault.folders, [{ id: "f1", name: "Infra" }]);
  assert.deepEqual(vault.items.map((i) => i.id), ["c1", "c2", "c3"]);

  const [openai, note, aws] = vault.items;
  assert.equal(openai.name, "OpenAI");
  assert.equal(openai.favorite, true);
  assert.equal(openai.folderId, "f1");
  assert.deepEqual(openai.login, { username: "me@x.com", password: "pw1", totp: null, uris: [{ uri: "https://openai.com" }] });
  assert.deepEqual(openai.fields, [
    { name: "apiKey", type: FieldType.Hidden, value: "sk-123" },
    { name: "prod", type: FieldType.Boolean, value: true },
    { name: "beta", type: FieldType.Boolean, value: false },
  ]);
  assert.equal(note.name, "DB note");
  assert.equal(note.notes, "host=db");
  assert.equal(aws.name, "AWS");
  assert.equal(aws.login?.password, "pw3");
  assert.equal(aws.login?.username, "");

  assert.equal(protectedUserKey(sync), "2.protected");
  assert.throws(() => protectedUserKey({ profile: {} }), /NO_USER_KEY/);
});

test("decryptVault decrypts card and SSH key items", async () => {
  const userKey = randomKey();
  const enc = (s: string) => encryptSym(s, userKey);
  const sync = {
    profile: {},
    folders: [],
    ciphers: [
      {
        id: "card", type: CipherType.Card, name: await enc("Visa"),
        card: {
          cardholderName: await enc("Kim"), number: await enc("4111111111111111"),
          expMonth: await enc("12"), expYear: await enc("2030"), code: await enc("123"), brand: await enc("Visa"),
        },
      },
      {
        id: "ssh", type: CipherType.SshKey, name: await enc("Server"),
        sshKey: { privateKey: await enc("-----BEGIN OPENSSH PRIVATE KEY-----"), publicKey: await enc("ssh-ed25519 AAAA"), keyFingerprint: await enc("SHA256:abc") },
      },
    ],
  };
  const vault = await decryptVault(sync, userKey);
  assert.equal(vault.failed, 0);
  assert.deepEqual(vault.items[0].card, { cardholderName: "Kim", number: "4111111111111111", expMonth: "12", expYear: "2030", code: "123", brand: "Visa" });
  assert.deepEqual(vault.items[1].sshKey, { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----", publicKey: "ssh-ed25519 AAAA", keyFingerprint: "SHA256:abc" });
});

test("ciphers of an org whose key can't be decrypted count as failed instead of aborting", async () => {
  const userKey = randomKey();
  const rsa = await rsaOrgKey(randomKey(), userKey);
  const sync = {
    profile: { privateKey: rsa.privateKey, organizations: [{ id: "org1", key: "4.bm90LXJzYQ==" }] },
    folders: [],
    ciphers: [
      { id: "mine", type: CipherType.Login, name: await encryptSym("Mine", userKey) },
      { id: "theirs", type: CipherType.Login, organizationId: "org1", name: "2.x|y|z" },
    ],
  };
  const vault = await decryptVault(sync, userKey);
  assert.deepEqual(vault.items.map((i) => i.id), ["mine"]);
  assert.equal(vault.failed, 1);
});
