// Autocomplete after typing `{{bw:` in the editor.

import {
  App,
  Editor,
  EditorSuggest,
  prepareFuzzySearch,
  type EditorPosition,
  type EditorSuggestContext,
  type EditorSuggestTriggerInfo,
} from "obsidian";
import type { Session } from "../core/session.ts";
import { insertEntries, type InsertEntry } from "./insert-entries.ts";

const TRIGGER_RE = /\{\{bw:([^{}]*)$/;
const MAX_SUGGESTIONS = 50;
const UNLOCK: InsertEntry = { label: "Unlock Bitwarden to search secrets…", text: "", block: false };

export class SecretSuggest extends EditorSuggest<InsertEntry> {
  private readonly session: Session;
  private readonly openUnlock: () => void;

  constructor(app: App, session: Session, openUnlock: () => void) {
    super(app);
    this.session = session;
    this.openUnlock = openUnlock;
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const m = TRIGGER_RE.exec(editor.getLine(cursor.line).slice(0, cursor.ch));
    return m ? { start: { line: cursor.line, ch: m.index }, end: cursor, query: m[1] } : null;
  }

  getSuggestions(ctx: EditorSuggestContext): InsertEntry[] {
    const vault = this.session.getVault();
    if (!vault) return [UNLOCK];
    const search = prepareFuzzySearch(ctx.query);
    return insertEntries(vault)
      .filter((e) => !e.block)
      .map((e) => ({ e, match: search(e.label) ?? search(e.text) }))
      .filter((x) => x.match)
      .sort((a, b) => b.match!.score - a.match!.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((x) => x.e);
  }

  renderSuggestion(entry: InsertEntry, el: HTMLElement): void {
    el.createDiv({ text: entry.label });
    if (entry.text) el.createEl("small", { cls: "bw-suggest-ref", text: entry.text });
  }

  selectSuggestion(entry: InsertEntry): void {
    const ctx = this.context;
    if (!ctx) return;
    if (entry === UNLOCK) {
      this.close();
      this.openUnlock();
      return;
    }
    // swallow an auto-paired "}}" right after the cursor
    const after = ctx.editor.getLine(ctx.end.line).slice(ctx.end.ch);
    const end = after.startsWith("}}") ? { line: ctx.end.line, ch: ctx.end.ch + 2 } : ctx.end;
    ctx.editor.replaceRange(entry.text, ctx.start, end);
  }
}
