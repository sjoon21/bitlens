import { test } from "node:test";
import assert from "node:assert/strict";
import { availableTargets, findRefs, parseRef, refLabel, resolveRef, resolveTarget, targetName } from "../src/editor/secret-ref.ts";
import { CipherType, FieldType, type Vault, type VaultItem } from "../src/types.ts";

test("parseRef reads item names and targets, defaulting to password", () => {
  assert.deepEqual(parseRef("OpenAI"), { item: "OpenAI", target: { kind: "password" } });
  assert.deepEqual(parseRef("OpenAI:username"), { item: "OpenAI", target: { kind: "username" } });
  assert.deepEqual(parseRef("OpenAI:password"), { item: "OpenAI", target: { kind: "password" } });
  assert.deepEqual(parseRef("OpenAI:totp"), { item: "OpenAI", target: { kind: "totp" } });
  assert.deepEqual(parseRef("OpenAI:notes"), { item: "OpenAI", target: { kind: "notes" } });
  assert.deepEqual(parseRef("OpenAI:field:apiKey"), { item: "OpenAI", target: { kind: "field", name: "apiKey" } });
});

test("parseRef keeps colons that are part of item or field names", () => {
  assert.deepEqual(parseRef("AWS: prod"), { item: "AWS: prod", target: { kind: "password" } });
  assert.deepEqual(parseRef("AWS: prod:username"), { item: "AWS: prod", target: { kind: "username" } });
  assert.deepEqual(parseRef("DB:field:conn:primary"), { item: "DB", target: { kind: "field", name: "conn:primary" } });
});

test("parseRef rejects empty item or field names", () => {
  assert.equal(parseRef(""), null);
  assert.equal(parseRef("  "), null);
  assert.equal(parseRef(":password"), null);
  assert.equal(parseRef("OpenAI:field:"), null);
});

test("findRefs returns offsets of every valid reference", () => {
  const text = "key {{bw:OpenAI:field:apiKey}} and {{bw:Server}} but not {{bw:}} or {bw:x}";
  const refs = findRefs(text);
  assert.deepEqual(refs.map((r) => text.slice(r.from, r.to)), ["{{bw:OpenAI:field:apiKey}}", "{{bw:Server}}"]);
  assert.equal(refs[1].ref.item, "Server");
});

test("findRefs does not span lines", () => {
  assert.deepEqual(findRefs("{{bw:Open\nAI}}"), []);
});

function vaultOf(...items: Partial<VaultItem>[]): Vault {
  const full = items.map((i, n) => ({ id: `i${n}`, type: CipherType.Login, favorite: false, folderId: null, name: "", ...i }));
  return { items: full, folders: [], failed: 0 };
}

const LOGIN = {
  name: "OpenAI",
  notes: "rotate monthly",
  login: { username: "me@x.com", password: "pw", totp: "JBSWY3DPEHPK3PXP", uris: [] },
  fields: [
    { name: "apiKey", type: FieldType.Hidden, value: "sk-123" },
    { name: "prod", type: FieldType.Boolean, value: true },
    { name: "user alias", type: FieldType.Linked, linkedId: 100 },
  ],
};

test("resolveRef returns each kind of value", () => {
  const v = vaultOf(LOGIN);
  const r = (s: string) => resolveRef(v, parseRef(s)!);
  assert.deepEqual(r("OpenAI"), { ok: true, value: "pw", totp: false });
  assert.deepEqual(r("OpenAI:username"), { ok: true, value: "me@x.com", totp: false });
  assert.deepEqual(r("OpenAI:notes"), { ok: true, value: "rotate monthly", totp: false });
  assert.deepEqual(r("OpenAI:totp"), { ok: true, value: "JBSWY3DPEHPK3PXP", totp: true });
  assert.deepEqual(r("OpenAI:field:apiKey"), { ok: true, value: "sk-123", totp: false });
  assert.deepEqual(r("OpenAI:field:prod"), { ok: true, value: "true", totp: false });
  assert.deepEqual(r("OpenAI:field:user alias"), { ok: true, value: "me@x.com", totp: false });
});

test("resolveRef explains what is missing", () => {
  const v = vaultOf(LOGIN, { name: "Dup" }, { name: "Dup" }, { name: "Note", type: CipherType.SecureNote });
  const err = (s: string) => {
    const res = resolveRef(v, parseRef(s)!);
    return res.ok ? null : res.error;
  };
  assert.equal(err("Nope"), "No item named “Nope”");
  assert.equal(err("Dup"), "2 items named “Dup”");
  assert.equal(err("OpenAI:field:missing"), "No field “missing”");
  assert.equal(err("Note"), "No password");
  assert.equal(err("Note:totp"), "No TOTP");
});

test("refLabel names the item and target", () => {
  assert.equal(refLabel(parseRef("OpenAI")!), "OpenAI");
  assert.equal(refLabel(parseRef("OpenAI:username")!), "OpenAI · username");
  assert.equal(refLabel(parseRef("OpenAI:field:apiKey")!), "OpenAI · apiKey");
});

test("availableTargets lists what an item actually has, in display order", () => {
  const [item] = vaultOf(LOGIN).items;
  assert.deepEqual(availableTargets(item).map(targetName), ["username", "password", "totp", "notes", "apiKey", "prod", "user alias"]);
  const [note] = vaultOf({ name: "N", type: CipherType.SecureNote }).items;
  assert.deepEqual(availableTargets(note), []);
});

test("resolveTarget works on an item directly, so duplicate names can still be read by id", () => {
  const v = vaultOf({ ...LOGIN, name: "Dup" }, { name: "Dup", login: { username: "other", password: "x", totp: null, uris: [] } });
  assert.deepEqual(resolveTarget(v.items[1], { kind: "username" }), { ok: true, value: "other", totp: false });
  assert.equal(resolveRef(v, parseRef("Dup:username")!).ok, false);
});
