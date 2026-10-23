// Copy / reveal helpers shared by the inline widget and the sidebar.

import { setIcon } from "obsidian";
import { parseTotp, totpCode } from "../core/totp.ts";
import type { Resolved } from "../editor/secret-ref.ts";

export const CLIPBOARD_CLEAR_MS = 30_000;
export const MASK = "••••••••"; // fixed length so the mask doesn't leak the secret's length

export async function plainValue(res: Resolved & { ok: true }): Promise<string> {
  if (!res.totp) return res.value;
  const params = parseTotp(res.value);
  if (!params) throw new Error("Invalid TOTP secret");
  return totpCode(params);
}

interface ElectronClipboard {
  readText(): string;
  clear(): void;
}

// Electron's clipboard works while Obsidian is unfocused (the user is usually pasting elsewhere
// when the timer fires); navigator.clipboard rejects then. Absent on mobile.
function electronClipboard(): ElectronClipboard | null {
  try {
    return (window as unknown as { require?: (m: string) => { clipboard?: ElectronClipboard } }).require?.("electron").clipboard ?? null;
  } catch {
    return null;
  }
}

// Clears the clipboard later unless the user has copied something else since.
// ponytail: `text` stays referenced by the timer for CLIPBOARD_CLEAR_MS, even across a lock.
async function clearClipboardIfUnchanged(text: string): Promise<void> {
  const electron = electronClipboard();
  try {
    if (electron) {
      if (electron.readText() === text) electron.clear();
    } else if ((await navigator.clipboard.readText()) === text) {
      await navigator.clipboard.writeText("");
    }
  } catch {
    // mobile WebViews may deny clipboard reads; clearing is best effort there
  }
}

export async function copyWithExpiry(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  window.setTimeout(() => void clearClipboardIfUnchanged(text), CLIPBOARD_CLEAR_MS);
}

// onClick may be async; it must handle its own errors (callers show a Notice).
export function iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const btn = parent.createEl("button", { cls: "bw-secret-btn clickable-icon", attr: { "aria-label": label, type: "button" } });
  setIcon(btn, icon);
  btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor cursor where it is
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void onClick();
  });
  return btn;
}
