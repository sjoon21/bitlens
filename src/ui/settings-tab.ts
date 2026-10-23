import { PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type BitwardenVaultPlugin from "../main.ts";
import type { Region } from "../types.ts";

const REGIONS: Record<Region, string> = {
  us: "bitwarden.com (US)",
  eu: "bitwarden.eu (EU)",
  self: "Self-hosted",
};

const AUTO_LOCK_OPTIONS: Record<string, string> = {
  "0": "Never",
  "1": "1 minute",
  "5": "5 minutes",
  "15": "15 minutes",
  "30": "30 minutes",
  "60": "1 hour",
};

export class BitwardenSettingTab extends PluginSettingTab {
  private readonly plugin: BitwardenVaultPlugin;

  constructor(plugin: BitwardenVaultPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  // Any account change invalidates the current session.
  private async saveAccount(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.session.lock();
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl).setName("Account").setHeading();

    new Setting(containerEl)
      .setName("Server")
      .addDropdown((d) => d
        .addOptions(REGIONS)
        .setValue(s.region)
        .onChange(async (v) => {
          s.region = v as Region;
          await this.saveAccount();
          this.display();
        }));

    if (s.region === "self") {
      new Setting(containerEl)
        .setName("Server URL")
        .setDesc("Base URL of your server, e.g. https://bitwarden.example.com. /identity and /api are appended.")
        .addText((t) => t
          .setPlaceholder("https://bitwarden.example.com")
          .setValue(s.serverUrl)
          .onChange(async (v) => {
            s.serverUrl = v.trim();
            await this.saveAccount();
          }));
    }

    new Setting(containerEl)
      .setName("Email")
      .setDesc("Used to derive your master key.")
      .addText((t) => {
        t.inputEl.type = "email";
        t.setValue(s.email).onChange(async (v) => {
          s.email = v.trim();
          await this.saveAccount();
        });
      });

    new Setting(containerEl)
      .setName("API key client_id")
      .setDesc("Web vault → Account settings → Security → Keys → API key.")
      .addText((t) => t
        .setPlaceholder("user.xxxxxxxx")
        .setValue(s.clientId)
        .onChange(async (v) => {
          s.clientId = v.trim();
          await this.saveAccount();
        }));

    new Setting(containerEl)
      .setName("API key client_secret")
      .setDesc("Kept in Obsidian's secret storage, outside your vault folder. Never written to data.json.")
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(s.clientSecretId)
        .onChange(async (id) => {
          s.clientSecretId = id ?? "";
          await this.saveAccount();
        }));

    new Setting(containerEl).setName("Security").setHeading();

    new Setting(containerEl)
      .setName("Auto-lock")
      .setDesc("Lock the vault after this much inactivity in Obsidian.")
      .addDropdown((d) => d
        .addOptions(AUTO_LOCK_OPTIONS)
        .setValue(String(s.autoLockMinutes))
        .onChange(async (v) => {
          s.autoLockMinutes = Number(v);
          await this.plugin.saveSettings();
        }));
  }
}
