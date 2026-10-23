import { App, Modal, Notice } from "obsidian";
import type { Session } from "../core/session.ts";
import { describeError } from "./errors.ts";

export class UnlockModal extends Modal {
  private readonly session: Session;
  private readonly onUnlocked?: () => void;

  constructor(app: App, session: Session, onUnlocked?: () => void) {
    super(app);
    this.session = session;
    this.onUnlocked = onUnlocked;
  }

  onOpen(): void {
    this.setTitle("Unlock Bitwarden");
    const form = this.contentEl.createEl("form", { cls: "bw-unlock-form" });
    const input = form.createEl("input", {
      type: "password",
      placeholder: "Master password",
      attr: { autocomplete: "current-password", "aria-label": "Master password" },
    });
    const error = form.createDiv({ cls: "bw-unlock-error", attr: { role: "alert" } });
    const button = form.createEl("button", { text: "Unlock", type: "submit", cls: "mod-cta" });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!input.value) return;
      input.disabled = button.disabled = true;
      button.setText("Unlocking…");
      error.setText("");
      try {
        await this.session.unlock(input.value);
        const vault = this.session.getVault();
        const count = `${vault?.items.length ?? 0} item(s)`;
        const failed = vault?.failed ? `, ${vault.failed} could not be decrypted` : "";
        new Notice(`Bitwarden unlocked: ${count}${failed}.`);
        this.close();
        this.onUnlocked?.();
      } catch (err) {
        error.setText(describeError(err));
        input.disabled = button.disabled = false;
        button.setText("Unlock");
        input.select();
      }
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty(); // drops the input element holding the password
  }
}
