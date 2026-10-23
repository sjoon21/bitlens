import { Notice, Plugin } from "obsidian";
import { BitwardenApi, endpoints, type Credentials } from "./core/api.ts";
import { argon2InWorker } from "./core/argon2-worker-client.ts";
import { Session } from "./core/session.ts";
import { insertEntries } from "./editor/insert-entries.ts";
import { secretLivePreview } from "./editor/live-preview.ts";
import { secretPostProcessor } from "./editor/reading-view.ts";
import { SecretSuggest } from "./editor/ref-suggest.ts";
import { DEFAULT_SETTINGS, type BitwardenPluginSettings } from "./types.ts";
import { describeError } from "./ui/errors.ts";
import { InsertSecretModal } from "./ui/insert-modal.ts";
import { BitwardenSettingTab } from "./ui/settings-tab.ts";
import { UnlockModal } from "./ui/unlock-modal.ts";
import { VAULT_VIEW_TYPE, VaultView } from "./ui/vault-view.ts";

const AUTO_LOCK_CHECK_MS = 30_000;

export default class BitwardenVaultPlugin extends Plugin {
  settings: BitwardenPluginSettings;
  api: BitwardenApi;
  session: Session;
  private statusBarEl: HTMLElement;
  private unloaded = false;

  async onload() {
    await this.loadSettings();
    this.api = new BitwardenApi(() => this.credentials());
    this.session = new Session({ api: this.api, email: () => this.settings.email, argon2: argon2InWorker });

    const widgetCtx = { session: this.session, openUnlock: () => this.openUnlockModal() };
    this.registerMarkdownPostProcessor(secretPostProcessor(widgetCtx));
    this.registerEditorExtension(secretLivePreview(widgetCtx));
    this.registerEditorSuggest(new SecretSuggest(this.app, this.session, () => this.openUnlockModal()));

    this.registerView(VAULT_VIEW_TYPE, (leaf) => new VaultView(leaf, {
      session: this.session,
      openUnlock: () => this.openUnlockModal(),
      sync: () => this.syncVault(),
    }));
    this.addRibbonIcon("shield", "Open Bitwarden vault", () => this.openVaultView());

    this.addSettingTab(new BitwardenSettingTab(this));
    this.registerCommands();
    this.registerStatusBar();
    this.registerAutoLock();
  }

  onunload() {
    this.unloaded = true; // rendered widgets can outlive the plugin until their note re-renders
    this.session.lock();
  }

  async openVaultView() {
    await this.app.workspace.ensureSideLeaf(VAULT_VIEW_TYPE, "right", { active: true, reveal: true });
  }

  syncVault() {
    this.session.sync().then(
      () => new Notice("Bitwarden synced."),
      (err) => new Notice(describeError(err)),
    );
  }

  openUnlockModal(onUnlocked?: () => void) {
    if (this.unloaded) return;
    new UnlockModal(this.app, this.session, onUnlocked).open();
  }

  private registerCommands() {
    this.addCommand({
      id: "open-vault",
      name: "Open vault sidebar",
      callback: () => this.openVaultView(),
    });
    this.addCommand({
      id: "insert-reference",
      name: "Insert secret reference",
      editorCallback: (editor) => {
        const pick = () => {
          const vault = this.session.getVault();
          if (vault) new InsertSecretModal(this.app, insertEntries(vault), editor).open();
        };
        if (this.session.isUnlocked) pick();
        else this.openUnlockModal(pick);
      },
    });
    this.addCommand({
      id: "unlock",
      name: "Unlock vault",
      checkCallback: (checking) => {
        if (this.session.isUnlocked) return false;
        if (!checking) this.openUnlockModal();
        return true;
      },
    });
    this.addCommand({
      id: "lock",
      name: "Lock vault",
      checkCallback: (checking) => {
        if (!this.session.isUnlocked) return false;
        if (!checking) this.session.lock();
        return true;
      },
    });
    this.addCommand({
      id: "sync",
      name: "Sync vault",
      checkCallback: (checking) => {
        if (!this.session.isUnlocked) return false;
        if (!checking) this.syncVault();
        return true;
      },
    });
  }

  // Desktop only (mobile has no status bar); the commands cover mobile.
  private registerStatusBar() {
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("mod-clickable");
    this.registerDomEvent(this.statusBarEl, "click", () => {
      if (this.session.isUnlocked) this.session.lock();
      else this.openUnlockModal();
    });
    const render = () => {
      const unlocked = this.session.isUnlocked;
      this.statusBarEl.setText(unlocked ? "🔓 Bitwarden" : "🔒 Bitwarden");
      this.statusBarEl.setAttr("aria-label", unlocked ? "Lock Bitwarden" : "Unlock Bitwarden");
    };
    render();
    this.register(this.session.onChange(render));
  }

  private registerAutoLock() {
    // ponytail: only main-window activity counts; listen on popout windows (workspace "window-open") if users report locks while typing there
    const touch = () => this.session.touch();
    this.registerDomEvent(document, "keydown", touch, { passive: true });
    this.registerDomEvent(document, "pointerdown", touch, { passive: true });
    this.registerInterval(window.setInterval(
      () => this.session.lockIfIdle(this.settings.autoLockMinutes * 60_000),
      AUTO_LOCK_CHECK_MS,
    ));
  }

  // The client_secret is read from Obsidian's SecretStorage, never from data.json.
  credentials(): Credentials {
    const s = this.settings;
    // trim: a pasted secret often carries a trailing newline/space, which the server rejects
    const clientSecret = s.clientSecretId ? this.app.secretStorage.getSecret(s.clientSecretId)?.trim() : null;
    if (!s.email || !s.clientId || !clientSecret) throw new Error("NOT_CONFIGURED");
    if (s.region === "self" && !s.serverUrl) throw new Error("NOT_CONFIGURED");
    return { endpoints: endpoints(s), email: s.email, clientId: s.clientId, clientSecret, deviceId: s.deviceId };
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.deviceId) {
      this.settings.deviceId = crypto.randomUUID();
      await this.saveSettings();
    }
  }

  async saveSettings() {
    // data.json may be synced or committed: NEVER put keys, tokens or passwords in settings.
    await this.saveData(this.settings);
  }
}
