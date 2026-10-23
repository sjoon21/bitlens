// Sidebar vault browser: search, favorites/folders, per-field copy / reveal / insert, live TOTP.
// Secret values are re-resolved by item id at click/tick time, never kept from render time.

import { ItemView, MarkdownView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";
import { parseTotp, totpCode, totpSecondsLeft } from "../core/totp.ts";
import type { Session } from "../core/session.ts";
import { referenceFor, uniqueNames } from "../editor/insert-entries.ts";
import { availableTargets, resolveTarget, targetName, type RefTarget, type Resolved } from "../editor/secret-ref.ts";
import { CipherType, FieldType, type VaultItem } from "../types.ts";
import { describeError } from "./errors.ts";
import { CLIPBOARD_CLEAR_MS, copyWithExpiry, iconButton, MASK, plainValue } from "./secret-actions.ts";
import { groupItems } from "./vault-groups.ts";

export const VAULT_VIEW_TYPE = "bitwarden-vault";

const TYPE_ICONS: Record<number, string> = {
  [CipherType.Login]: "globe",
  [CipherType.SecureNote]: "sticky-note",
  [CipherType.Card]: "credit-card",
  [CipherType.Identity]: "user",
  [CipherType.SshKey]: "terminal",
};

export interface VaultViewDeps {
  session: Session;
  openUnlock: () => void;
  sync: () => void;
}

function isHidden(item: VaultItem, t: RefTarget): boolean {
  if (t.kind === "password" || t.kind === "notes") return true;
  return t.kind === "field" && item.fields?.find((f) => f.name === t.name)?.type === FieldType.Hidden;
}

function formatTotp(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export class VaultView extends ItemView {
  private readonly deps: VaultViewDeps;
  private query = "";
  private readonly expanded = new Set<string>();
  private readonly tickers = new Set<() => Promise<void>>();
  private listEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, deps: VaultViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VAULT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "BitLens";
  }

  getIcon(): string {
    return "shield";
  }

  async onOpen(): Promise<void> {
    // A sync keeps the session unlocked: refresh only the list so search focus and scroll survive.
    this.register(this.deps.session.onChange(() => {
      if (this.deps.session.isUnlocked && this.listEl) this.renderList();
      else this.render();
    }));
    this.registerInterval(window.setInterval(() => this.tickers.forEach((tick) => void tick()), 1000));
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("bw-view");
    this.tickers.clear();
    if (!this.deps.session.isUnlocked) {
      this.expanded.clear();
      this.listEl = null;
      const locked = root.createDiv("bw-view-locked");
      setIcon(locked.createDiv("bw-view-locked-icon"), "lock");
      locked.createEl("p", { text: "Your vault is locked." });
      locked.createEl("button", { text: "Unlock", cls: "mod-cta" }).addEventListener("click", this.deps.openUnlock);
      return;
    }

    const header = root.createDiv("bw-view-header");
    const search = header.createEl("input", { type: "search", placeholder: "Search vault", attr: { "aria-label": "Search vault" } });
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.renderList();
    });
    iconButton(header, "refresh-cw", "Sync vault", this.deps.sync);
    iconButton(header, "lock", "Lock vault", () => this.deps.session.lock());

    this.listEl = root.createDiv("bw-view-list");
    this.renderList();
  }

  private renderList(): void {
    const vault = this.deps.session.getVault();
    const list = this.listEl;
    if (!vault || !list) return;
    list.empty();
    this.tickers.clear();
    if (vault.failed) list.createDiv({ cls: "bw-view-warning", text: `${vault.failed} item(s) could not be decrypted.` });

    const groups = groupItems(vault, this.query);
    if (!groups.length) list.createDiv({ cls: "bw-view-empty", text: this.query ? "No matching items." : "Your vault is empty." });
    const unique = uniqueNames(vault);
    for (const g of groups) {
      const section = list.createDiv("bw-group");
      section.createDiv({ cls: "bw-group-title", text: g.title });
      for (const item of g.items) this.renderItem(section, item, unique.has(item.name));
    }
  }

  private renderItem(parent: HTMLElement, item: VaultItem, referenceable: boolean): void {
    const row = parent.createDiv("bw-item");
    const head = row.createEl("button", { cls: "bw-item-head", attr: { type: "button" } });
    setIcon(head.createSpan("bw-item-icon"), TYPE_ICONS[item.type] ?? "file");
    const text = head.createDiv("bw-item-text");
    text.createDiv({ cls: "bw-item-name", text: item.name });
    if (item.login?.username) text.createDiv({ cls: "bw-item-sub", text: item.login.username });

    let detail: HTMLElement | null = null;
    const sync = () => {
      const open = this.expanded.has(item.id);
      head.setAttr("aria-expanded", String(open));
      row.toggleClass("is-open", open);
      detail?.remove();
      detail = open ? this.renderDetail(row, item, referenceable) : null;
    };
    head.addEventListener("click", () => {
      if (this.expanded.has(item.id)) this.expanded.delete(item.id);
      else this.expanded.add(item.id);
      sync();
    });
    sync();
  }

  private renderDetail(row: HTMLElement, item: VaultItem, referenceable: boolean): HTMLElement {
    const detail = row.createDiv("bw-detail");
    const targets = availableTargets(item);
    for (const t of targets) this.renderField(detail, item, t, referenceable ? referenceFor(item, t) : null);
    for (const { uri } of item.login?.uris ?? []) {
      if (!uri) continue;
      const line = detail.createDiv("bw-field");
      line.createDiv({ cls: "bw-field-label", text: "website" });
      const safe = /^https?:\/\//i.test(uri);
      if (safe) line.createEl("a", { cls: "bw-field-value", text: uri, href: uri });
      else line.createDiv({ cls: "bw-field-value", text: uri });
    }
    if (!targets.length && !item.login?.uris.length) detail.createDiv({ cls: "bw-view-empty", text: "Nothing to show for this item type yet." });
    return detail;
  }

  // Looks the value up again from the live session; null (with a notice) when it's gone.
  private current(itemId: string, t: RefTarget): (Resolved & { ok: true }) | null {
    const item = this.deps.session.getVault()?.items.find((i) => i.id === itemId);
    const res: Resolved = item ? resolveTarget(item, t) : { ok: false, error: "Item no longer in the vault" };
    if (!res.ok) new Notice(res.error);
    return res.ok ? res : null;
  }

  private renderField(parent: HTMLElement, item: VaultItem, t: RefTarget, reference: string | null): void {
    const line = parent.createDiv("bw-field");
    const name = targetName(t);
    line.createDiv({ cls: "bw-field-label", text: name });
    const valueEl = line.createDiv("bw-field-value");
    const actions = line.createDiv("bw-field-actions");

    iconButton(actions, "copy", `Copy ${name}`, async () => {
      const res = this.current(item.id, t);
      if (!res) return;
      try {
        await copyWithExpiry(await plainValue(res));
        new Notice(`Copied ${item.name} · ${name}. Clipboard clears in ${CLIPBOARD_CLEAR_MS / 1000}s.`);
      } catch (err) {
        new Notice(describeError(err));
      }
    });

    if (t.kind === "totp") {
      this.renderTotp(valueEl, item.id);
    } else if (isHidden(item, t)) {
      valueEl.setText(MASK);
      let revealed = false;
      const toggle = iconButton(actions, "eye", `Show ${name}`, () => {
        const res = revealed ? null : this.current(item.id, t);
        if (!revealed && !res) return;
        revealed = !revealed;
        valueEl.setText(res ? res.value : MASK);
        valueEl.toggleClass("is-revealed", revealed);
        setIcon(toggle, revealed ? "eye-off" : "eye");
        toggle.setAttr("aria-label", `${revealed ? "Hide" : "Show"} ${name}`);
      });
    } else {
      const res = resolveTarget(item, t);
      valueEl.setText(res.ok ? res.value : res.error);
    }

    if (reference) iconButton(actions, "file-input", `Insert reference to ${name}`, () => this.insert(reference));
  }

  private renderTotp(valueEl: HTMLElement, itemId: string): void {
    const codeEl = valueEl.createSpan({ cls: "bw-totp-code", text: "······" });
    const secsEl = valueEl.createSpan("bw-totp-secs");
    const bar = valueEl.createDiv("bw-totp-bar").createDiv("bw-totp-fill");
    let shownStep = -1;
    const tick = async () => {
      if (!codeEl.isConnected) return void this.tickers.delete(tick);
      const item = this.deps.session.getVault()?.items.find((i) => i.id === itemId);
      const params = parseTotp(item?.login?.totp);
      if (!params) return void codeEl.setText("Invalid TOTP");
      const left = totpSecondsLeft(params.period);
      secsEl.setText(`${left}s`);
      bar.style.transform = `scaleX(${left / params.period})`;
      bar.toggleClass("is-low", left <= 5);
      const step = Math.floor(Date.now() / 1000 / params.period);
      if (step !== shownStep) {
        shownStep = step;
        try {
          codeEl.setText(formatTotp(await totpCode(params)));
        } catch {
          codeEl.setText("Invalid TOTP"); // e.g. a secret with no base32 characters
        }
      }
    };
    this.tickers.add(tick);
    void tick();
  }

  // Inserts into the note that was active before the sidebar took focus.
  private insert(reference: string): void {
    const leaf = this.app.workspace.getMostRecentLeaf();
    // In Reading view the editor is hidden and its cursor stale, so only insert into an editing view.
    if (!leaf || !(leaf.view instanceof MarkdownView) || leaf.view.getMode() !== "source") {
      new Notice("Open a note in editing view to insert the reference.");
      return;
    }
    leaf.view.editor.replaceSelection(reference);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
}
