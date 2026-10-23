// `{{bw:Item[:username|password|totp|notes|field:Name]}}` references. Pure: no Obsidian/DOM.

import type { Vault, VaultItem } from "../types.ts";
import { FieldType } from "../types.ts";

export type RefTarget =
  | { kind: "password" | "username" | "totp" | "notes" }
  | { kind: "field"; name: string };

export interface SecretRef {
  item: string;
  target: RefTarget;
}

export interface RefMatch {
  from: number;
  to: number;
  ref: SecretRef;
}

export type Resolved = { ok: true; value: string; totp: boolean } | { ok: false; error: string };

const SIMPLE_TARGETS = ["password", "username", "totp", "notes"] as const;
const FIELD_MARKER = ":field:";
const REF_RE = /\{\{bw:([^{}\n]*)\}\}/g;

// Item names may contain ":", so targets are matched from the right.
export function parseRef(inner: string): SecretRef | null {
  const s = inner.trim();
  const fieldAt = s.indexOf(FIELD_MARKER);
  if (fieldAt >= 0) {
    const item = s.slice(0, fieldAt).trim();
    const name = s.slice(fieldAt + FIELD_MARKER.length).trim();
    return item && name ? { item, target: { kind: "field", name } } : null;
  }
  const colon = s.lastIndexOf(":");
  const suffix = s.slice(colon + 1) as (typeof SIMPLE_TARGETS)[number];
  if (colon >= 0 && SIMPLE_TARGETS.includes(suffix)) {
    const item = s.slice(0, colon).trim();
    return item ? { item, target: { kind: suffix } } : null;
  }
  return s ? { item: s, target: { kind: "password" } } : null;
}

export function findRefs(text: string): RefMatch[] {
  const out: RefMatch[] = [];
  for (const m of text.matchAll(REF_RE)) {
    const ref = parseRef(m[1]);
    if (ref) out.push({ from: m.index, to: m.index + m[0].length, ref });
  }
  return out;
}

export function targetName(t: RefTarget): string {
  return t.kind === "field" ? t.name : t.kind;
}

// The part after "Item:" in a reference.
export function targetSuffix(t: RefTarget): string {
  return t.kind === "field" ? `field:${t.name}` : t.kind;
}

export function refLabel(ref: SecretRef): string {
  return ref.target.kind === "password" ? ref.item : `${ref.item} · ${targetName(ref.target)}`;
}

// Targets an item actually has a value for, in display order.
export function availableTargets(item: VaultItem): RefTarget[] {
  const out: RefTarget[] = [];
  if (item.login?.username) out.push({ kind: "username" });
  if (item.login?.password) out.push({ kind: "password" });
  if (item.login?.totp) out.push({ kind: "totp" });
  if (item.notes) out.push({ kind: "notes" });
  for (const f of item.fields ?? []) if (f.name) out.push({ kind: "field", name: f.name });
  return out;
}

// LoginLinkedId values in Bitwarden
const LINKED_LOGIN: Record<number, "username" | "password"> = { 100: "username", 101: "password" };

function fieldValue(item: VaultItem, name: string): Resolved {
  const f = item.fields?.find((x) => x.name === name);
  if (!f) return { ok: false, error: `No field “${name}”` };
  if (f.type === FieldType.Linked) {
    const linked = f.linkedId !== undefined ? LINKED_LOGIN[f.linkedId] : undefined;
    const value = linked ? item.login?.[linked] : undefined;
    return value !== undefined ? { ok: true, value, totp: false } : { ok: false, error: `Unsupported linked field “${name}”` };
  }
  return { ok: true, value: String(f.value ?? ""), totp: false };
}

export function resolveTarget(item: VaultItem, t: RefTarget): Resolved {
  if (t.kind === "field") return fieldValue(item, t.name);
  if (t.kind === "notes") return item.notes ? { ok: true, value: item.notes, totp: false } : { ok: false, error: "No notes" };
  if (t.kind === "totp") {
    return item.login?.totp ? { ok: true, value: item.login.totp, totp: true } : { ok: false, error: "No TOTP" };
  }
  const value = item.login?.[t.kind];
  return value ? { ok: true, value, totp: false } : { ok: false, error: t.kind === "password" ? "No password" : "No username" };
}

export function resolveRef(vault: Vault, ref: SecretRef): Resolved {
  const matches = vault.items.filter((i) => i.name === ref.item);
  if (matches.length === 0) return { ok: false, error: `No item named “${ref.item}”` };
  if (matches.length > 1) return { ok: false, error: `${matches.length} items named “${ref.item}”` };
  return resolveTarget(matches[0], ref.target);
}
