// Inline widget for a `{{bw:...}}` reference, shared by Reading view and Live Preview.
// Values are resolved from the session on each click, never captured at render time,
// so nothing secret lingers in the DOM or closures once the vault locks.

import { Notice, setIcon } from "obsidian";
import type { Session } from "../core/session.ts";
import { describeError } from "../ui/errors.ts";
import { CLIPBOARD_CLEAR_MS, copyWithExpiry, iconButton, MASK, plainValue } from "../ui/secret-actions.ts";
import { refLabel, resolveRef, type Resolved, type SecretRef } from "./secret-ref.ts";

export interface WidgetContext {
  session: Session;
  openUnlock: () => void;
}

function resolveNow(ctx: WidgetContext, ref: SecretRef): Resolved | null {
  const vault = ctx.session.getVault();
  return vault ? resolveRef(vault, ref) : null;
}

export function renderSecret(el: HTMLElement, ref: SecretRef, ctx: WidgetContext): void {
  el.empty();
  el.className = "bw-secret";
  const label = refLabel(ref);
  const res = resolveNow(ctx, ref);

  if (!res) {
    el.addClass("is-locked");
    const btn = iconButton(el, "lock", "Unlock Bitwarden", ctx.openUnlock);
    btn.createSpan({ cls: "bw-secret-label", text: label });
    return;
  }
  if (!res.ok) {
    el.addClass("is-error");
    el.setAttr("aria-label", res.error);
    setIcon(el.createSpan({ cls: "bw-secret-icon" }), "alert-triangle");
    el.createSpan({ cls: "bw-secret-label", text: `${label}: ${res.error}` });
    return;
  }

  setIcon(el.createSpan({ cls: "bw-secret-icon" }), res.totp ? "clock" : "key-round");
  el.createSpan({ cls: "bw-secret-label", text: label });
  const valueEl = el.createEl("code", { cls: "bw-secret-value", text: MASK });

  // Re-resolves at click time; returns null (after telling the user why) when the value is gone.
  const current = (): (Resolved & { ok: true }) | null => {
    const fresh = resolveNow(ctx, ref);
    if (!fresh) ctx.openUnlock();
    else if (!fresh.ok) new Notice(fresh.error);
    return fresh?.ok ? fresh : null;
  };

  iconButton(el, "copy", `Copy ${label}`, async () => {
    const fresh = current();
    if (!fresh) return;
    try {
      await copyWithExpiry(await plainValue(fresh));
      new Notice(`Copied ${label}. Clipboard clears in ${CLIPBOARD_CLEAR_MS / 1000}s.`);
    } catch (err) {
      new Notice(describeError(err));
    }
  });

  let revealed = false;
  const toggle = iconButton(el, "eye", `Show ${label}`, async () => {
    if (revealed) {
      valueEl.setText(MASK);
    } else {
      const fresh = current();
      if (!fresh) return;
      try {
        valueEl.setText(await plainValue(fresh));
      } catch (err) {
        new Notice(describeError(err));
        return;
      }
    }
    revealed = !revealed;
    setIcon(toggle, revealed ? "eye-off" : "eye");
    toggle.setAttr("aria-label", `${revealed ? "Hide" : "Show"} ${label}`);
  });
}
