// Choices for inserting `{{bw:...}}` references: one per available value, plus an
// "all fields" block per item. Pure: shared by the picker, autocomplete and sidebar.

import type { Vault, VaultItem } from "../types.ts";
import { availableTargets, findRefs, targetName, targetSuffix, type RefTarget } from "./secret-ref.ts";

export interface InsertEntry {
  label: string;
  text: string;
  block: boolean; // multi-line, only sensible at the start of a line
}

// Names shared by several items can't be referenced (resolution would be ambiguous).
export function uniqueNames(vault: Vault): Set<string> {
  const counts = new Map<string, number>();
  for (const i of vault.items) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n === 1).map(([name]) => name));
}

// The reference text, or null when the name would break the syntax or parse back as another item.
// Uniqueness is the caller's job (see uniqueNames).
export function referenceFor(item: VaultItem, target: RefTarget): string | null {
  const ref = `{{bw:${item.name}:${targetSuffix(target)}}}`;
  const refs = findRefs(ref);
  const ok = refs.length === 1 && refs[0].from === 0 && refs[0].to === ref.length && refs[0].ref.item === item.name;
  return ok ? ref : null;
}

export function insertEntries(vault: Vault): InsertEntry[] {
  const unique = uniqueNames(vault);
  const entries: InsertEntry[] = [];
  for (const item of vault.items) {
    if (!unique.has(item.name)) continue;
    const parts = availableTargets(item)
      .map((t) => ({ name: targetName(t), ref: referenceFor(item, t) }))
      .filter((p): p is { name: string; ref: string } => p.ref !== null);
    for (const p of parts) entries.push({ label: `${item.name} › ${p.name}`, text: p.ref, block: false });
    if (parts.length > 1) {
      const text = parts.map((p) => `- ${p.name}: ${p.ref}\n`).join("");
      entries.push({ label: `${item.name} › all fields`, text, block: true });
    }
  }
  return entries;
}
