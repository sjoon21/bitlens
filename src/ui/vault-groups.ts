// Sidebar grouping and search. Pure: no Obsidian/DOM.

import type { Vault, VaultItem } from "../types.ts";

export interface ItemGroup {
  title: string;
  items: VaultItem[];
}

function matches(item: VaultItem, q: string): boolean {
  if (!q) return true;
  const haystack = [item.name, item.login?.username ?? "", ...(item.login?.uris ?? []).map((u) => u.uri)];
  return haystack.some((s) => s.toLowerCase().includes(q));
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

// Favorites are listed once, in their own group. Unknown folder ids fall into "No folder".
// ponytail: nested folders ("Work/Infra") are shown flat by full name; build a tree if vaults get deep
export function groupItems(vault: Vault, query: string): ItemGroup[] {
  const q = query.trim().toLowerCase();
  const items = vault.items.filter((i) => matches(i, q)).sort(byName);
  const groups: ItemGroup[] = [{ title: "Favorites", items: items.filter((i) => i.favorite) }];
  const rest = items.filter((i) => !i.favorite);
  const folderIds = new Set(vault.folders.map((f) => f.id));
  for (const f of [...vault.folders].sort(byName)) {
    groups.push({ title: f.name, items: rest.filter((i) => i.folderId === f.id) });
  }
  groups.push({ title: "No folder", items: rest.filter((i) => !i.folderId || !folderIds.has(i.folderId)) });
  return groups.filter((g) => g.items.length);
}
