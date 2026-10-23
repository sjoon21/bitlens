import { test } from "node:test";
import assert from "node:assert/strict";
import { groupItems } from "../src/ui/vault-groups.ts";
import { CipherType, type Vault, type VaultItem } from "../src/types.ts";

function item(name: string, extra: Partial<VaultItem> = {}): VaultItem {
  return { id: name, type: CipherType.Login, favorite: false, folderId: null, name, ...extra };
}

const VAULT: Vault = {
  folders: [{ id: "f-work", name: "Work" }, { id: "f-home", name: "Home" }],
  failed: 0,
  items: [
    item("zeta", { folderId: "f-work" }),
    item("Alpha", { folderId: "f-work", login: { username: "deploy@corp", password: "", totp: null, uris: [{ uri: "https://ci.corp.io" }] } }),
    item("Starred", { favorite: true, folderId: "f-home" }),
    item("Loose"),
    item("Orphan", { folderId: "f-deleted" }),
  ],
};

const view = (groups: ReturnType<typeof groupItems>) => groups.map((g) => [g.title, g.items.map((i) => i.name)]);

test("groupItems puts favorites first, then folders by name, then items without a folder", () => {
  assert.deepEqual(view(groupItems(VAULT, "")), [
    ["Favorites", ["Starred"]],
    ["Work", ["Alpha", "zeta"]],
    ["No folder", ["Loose", "Orphan"]],
  ]);
});

test("groupItems searches names, usernames and URIs case-insensitively and drops empty groups", () => {
  assert.deepEqual(view(groupItems(VAULT, "ALP")), [["Work", ["Alpha"]]]);
  assert.deepEqual(view(groupItems(VAULT, "deploy")), [["Work", ["Alpha"]]]);
  assert.deepEqual(view(groupItems(VAULT, "ci.corp")), [["Work", ["Alpha"]]]);
  assert.deepEqual(view(groupItems(VAULT, "nothing")), []);
});
