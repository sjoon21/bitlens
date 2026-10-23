import { test } from "node:test";
import assert from "node:assert/strict";
import { insertEntries } from "../src/editor/insert-entries.ts";
import { findRefs, parseRef, resolveRef } from "../src/editor/secret-ref.ts";
import { CipherType, FieldType, type Vault, type VaultItem } from "../src/types.ts";

function vaultOf(...items: Partial<VaultItem>[]): Vault {
  const full = items.map((i, n) => ({ id: `i${n}`, type: CipherType.Login, favorite: false, folderId: null, name: "", ...i }));
  return { items: full, folders: [], failed: 0 };
}

const OPENAI = {
  name: "OpenAI",
  login: { username: "me@x.com", password: "pw", totp: "JBSWY3DPEHPK3PXP", uris: [] },
  fields: [{ name: "apiKey", type: FieldType.Hidden, value: "sk-123" }],
};

test("insertEntries offers each available value plus an all-fields block per item", () => {
  const entries = insertEntries(vaultOf(OPENAI, { name: "Notes only", type: CipherType.SecureNote, notes: "n" }));
  assert.deepEqual(entries.map((e) => [e.label, e.text]), [
    ["OpenAI › username", "{{bw:OpenAI:username}}"],
    ["OpenAI › password", "{{bw:OpenAI:password}}"],
    ["OpenAI › totp", "{{bw:OpenAI:totp}}"],
    ["OpenAI › apiKey", "{{bw:OpenAI:field:apiKey}}"],
    ["OpenAI › all fields", [
      "- username: {{bw:OpenAI:username}}",
      "- password: {{bw:OpenAI:password}}",
      "- totp: {{bw:OpenAI:totp}}",
      "- apiKey: {{bw:OpenAI:field:apiKey}}",
      "",
    ].join("\n")],
    ["Notes only › notes", "{{bw:Notes only:notes}}"],
  ]);
  assert.deepEqual(entries.map((e) => e.block), [false, false, false, false, true, false]);
});

test("every generated reference parses back and resolves to the right value", () => {
  const vault = vaultOf(OPENAI);
  for (const e of insertEntries(vault).filter((x) => !x.block)) {
    const [m] = findRefs(e.text);
    assert.ok(m, e.text);
    assert.equal(resolveRef(vault, parseRef(e.text.slice(5, -2))!).ok, true, e.text);
  }
});

test("insertEntries skips items and fields whose names can't be referenced", () => {
  const entries = insertEntries(vaultOf(
    { name: "Dup", login: { username: "a", password: "b", totp: null, uris: [] } },
    { name: "Dup", login: { username: "a", password: "b", totp: null, uris: [] } },
    { name: "Bad}}name", login: { username: "a", password: "", totp: null, uris: [] } },
    { name: "A:field:B", login: { username: "a", password: "", totp: null, uris: [] } },
    { name: "Ok", fields: [{ name: "x}}y", type: FieldType.Text, value: "v" }, { name: "", type: FieldType.Text, value: "v" }] },
  ));
  assert.deepEqual(entries, []);
});
