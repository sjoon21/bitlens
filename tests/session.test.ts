import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMasterKey, stretchKey } from "../src/core/crypto.ts";
import { Session, type SessionApi } from "../src/core/session.ts";
import { CipherType, type KdfConfig } from "../src/types.ts";
import { encryptSym, keyBytes, randomKey } from "./helpers.ts";

const EMAIL = "user@example.com";
const PASSWORD = "correct horse";
const KDF: KdfConfig = { type: 0, iterations: 1000, memory: 64, parallelism: 4 };

async function fixture() {
  const stretched = stretchKey(await makeMasterKey(PASSWORD, EMAIL, KDF));
  const userKey = randomKey();
  return {
    profile: { key: await encryptSym(keyBytes(userKey), stretched) },
    folders: [],
    ciphers: [{ id: "c1", type: CipherType.Login, name: await encryptSym("OpenAI", userKey) }],
  };
}

function fakeApi(sync: unknown, syncGate?: Promise<void>) {
  const calls = { clearToken: 0, sync: 0 };
  const api: SessionApi = {
    prelogin: async () => KDF,
    sync: async () => {
      calls.sync++;
      await syncGate;
      return sync;
    },
    clearToken: () => { calls.clearToken++; },
  };
  return { api, calls };
}

test("unlock decrypts the vault, notifies listeners, and lock clears everything", async () => {
  const { api, calls } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  let changes = 0;
  session.onChange(() => changes++);

  await session.unlock(PASSWORD);
  assert.equal(session.isUnlocked, true);
  assert.deepEqual(session.getVault()?.items.map((i) => i.name), ["OpenAI"]);
  assert.equal(changes, 1);

  session.lock();
  assert.equal(session.isUnlocked, false);
  assert.equal(session.getVault(), null);
  assert.equal(calls.clearToken, 1);
  assert.equal(changes, 2);
});

test("wrong password rejects with MAC_FAILED, stays locked and drops the token", async () => {
  const { api, calls } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  await assert.rejects(session.unlock("wrong"), /MAC_FAILED/);
  assert.equal(session.isUnlocked, false);
  assert.equal(calls.clearToken, 1);
});

test("two concurrent unlocks leave one working session", async () => {
  const { api } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  await Promise.all([session.unlock(PASSWORD), session.unlock(PASSWORD)]);
  await session.sync();
  assert.deepEqual(session.getVault()?.items.map((i) => i.name), ["OpenAI"]);
  assert.equal(session.getVault()?.failed, 0);
});

test("locking during an in-flight unlock rejects with LOCKED and discards the result", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const { api } = fakeApi(await fixture(), gate);
  const session = new Session({ api, email: () => EMAIL });

  const pending = session.unlock(PASSWORD);
  session.lock();
  release();
  await assert.rejects(pending, /LOCKED/);
  assert.equal(session.isUnlocked, false);
  assert.equal(session.getVault(), null);
});

test("sync requires an unlocked session", async () => {
  const { api } = fakeApi(await fixture());
  await assert.rejects(new Session({ api, email: () => EMAIL }).sync(), /LOCKED/);
});

test("lockIfIdle locks only after the idle limit, and 0 disables it", async () => {
  const { api } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  await session.unlock(PASSWORD);

  session.touch(1_000);
  session.lockIfIdle(0, 10_000_000);
  assert.equal(session.isUnlocked, true);
  session.lockIfIdle(60_000, 60_999);
  assert.equal(session.isUnlocked, true);
  session.lockIfIdle(60_000, 61_000);
  assert.equal(session.isUnlocked, false);
});

test("onChange unsubscribe stops notifications (views rely on it to avoid leaks)", async () => {
  const { api } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  let kept = 0;
  let dropped = 0;
  session.onChange(() => kept++);
  const unsubscribe = session.onChange(() => dropped++);
  unsubscribe();
  await session.unlock(PASSWORD);
  session.lock();
  assert.equal(kept, 2);
  assert.equal(dropped, 0);
});

test("a throwing listener doesn't block the others", async () => {
  const { api } = fakeApi(await fixture());
  const session = new Session({ api, email: () => EMAIL });
  let reached = false;
  const original = console.error;
  console.error = () => {};
  try {
    session.onChange(() => { throw new Error("broken view"); });
    session.onChange(() => { reached = true; });
    await session.unlock(PASSWORD);
  } finally {
    console.error = original;
  }
  assert.equal(reached, true);
  assert.equal(session.isUnlocked, true);
});
