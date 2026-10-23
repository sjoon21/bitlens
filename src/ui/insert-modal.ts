import { App, Editor, FuzzySuggestModal } from "obsidian";
import type { InsertEntry } from "../editor/insert-entries.ts";

// Command palette picker: inserts a single reference or an item's all-fields block at the cursor.
export class InsertSecretModal extends FuzzySuggestModal<InsertEntry> {
  private readonly entries: InsertEntry[];
  private readonly editor: Editor;

  constructor(app: App, entries: InsertEntry[], editor: Editor) {
    super(app);
    this.entries = entries;
    this.editor = editor;
    this.setPlaceholder("Search Bitwarden items and fields…");
  }

  getItems(): InsertEntry[] {
    return this.entries;
  }

  getItemText(entry: InsertEntry): string {
    return entry.label;
  }

  onChooseItem(entry: InsertEntry): void {
    const cursor = this.editor.getCursor();
    const atLineStart = this.editor.getLine(cursor.line).slice(0, cursor.ch).trim() === "";
    this.editor.replaceSelection(entry.block && !atLineStart ? "\n" + entry.text : entry.text);
  }
}
