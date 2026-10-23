// In-memory session: the decrypted user key and vault exist only here, never on disk.
// No Obsidian imports so it can be unit-tested under Node.

import type { SymKey, Vault } from "../types.ts";
import type { BitwardenApi } from "./api.ts";
import { makeMasterKey, unwrapUserKey, wipeKey, type Argon2Fn } from "./crypto.ts";
import { decryptVault, protectedUserKey } from "./vault.ts";

export type SessionApi = Pick<BitwardenApi, "prelogin" | "sync" | "clearToken">;

export interface SessionDeps {
  api: SessionApi;
  email: () => string;
  argon2?: Argon2Fn;
}

export class Session {
  private readonly deps: SessionDeps;
  private userKey: SymKey | null = null;
  private vault: Vault | null = null;
  // Bumped on every lock; async work started under an older generation must not publish results.
  private generation = 0;
  private lastActivity = Date.now();
  private readonly listeners = new Set<() => void>();
  // Increments on every lock/unlock/sync so views can tell stale renders apart.
  private rev = 0;

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  get revision(): number {
    return this.rev;
  }

  get isUnlocked(): boolean {
    return this.userKey !== null;
  }

  getVault(): Vault | null {
    return this.vault;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this.rev++;
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error("Bitwarden: session listener failed", err); // one broken view must not block the others
      }
    }
  }

  touch(now = Date.now()): void {
    this.lastActivity = now;
  }

  // Throws MAC_FAILED on a wrong master password, LOCKED if lock() ran meanwhile.
  async unlock(password: string): Promise<void> {
    const gen = this.generation;
    let opened: { userKey: SymKey; vault: Vault };
    try {
      opened = await this.open(password);
    } catch (err) {
      if (!this.isUnlocked) this.deps.api.clearToken(); // don't keep a token for a failed unlock
      throw err;
    }
    if (gen !== this.generation) {
      wipeKey(opened.userKey);
      throw new Error("LOCKED");
    }
    if (this.userKey) {
      // a concurrent unlock won; keep its key (an in-flight sync may be using it) and drop ours
      wipeKey(opened.userKey);
      return;
    }
    this.userKey = opened.userKey;
    this.vault = opened.vault;
    this.touch();
    this.emit();
  }

  private async open(password: string): Promise<{ userKey: SymKey; vault: Vault }> {
    const [kdf, raw] = await Promise.all([this.deps.api.prelogin(), this.deps.api.sync()]);
    const masterKey = await makeMasterKey(password, this.deps.email(), kdf, this.deps.argon2);
    let userKey: SymKey;
    try {
      userKey = await unwrapUserKey(protectedUserKey(raw), masterKey);
    } finally {
      masterKey.fill(0);
    }
    try {
      return { userKey, vault: await decryptVault(raw, userKey) };
    } catch (err) {
      wipeKey(userKey);
      throw err;
    }
  }

  async sync(): Promise<void> {
    const userKey = this.userKey;
    if (!userKey) throw new Error("LOCKED");
    const gen = this.generation;
    const vault = await decryptVault(await this.deps.api.sync(), userKey);
    if (gen !== this.generation) throw new Error("LOCKED");
    this.vault = vault;
    this.emit();
  }

  lock(): void {
    this.generation++;
    const wasUnlocked = this.isUnlocked;
    if (this.userKey) wipeKey(this.userKey);
    this.userKey = null;
    this.vault = null;
    this.deps.api.clearToken();
    if (wasUnlocked) this.emit();
  }

  // maxIdleMs <= 0 disables auto-lock
  lockIfIdle(maxIdleMs: number, now = Date.now()): void {
    if (this.isUnlocked && maxIdleMs > 0 && now - this.lastActivity >= maxIdleMs) this.lock();
  }
}
