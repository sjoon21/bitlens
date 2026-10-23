// Bitwarden Identity / API client. The access token lives only in memory.
// requestUrl (not fetch) because Bitwarden's API does not allow the app:// origin via CORS.

import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { BitwardenPluginSettings, KdfConfig } from "../types.ts";
import { checkKdf } from "./crypto.ts";
import { camelize } from "./wire.ts";

export interface Endpoints {
  identity: string;
  api: string;
}

export interface Credentials {
  endpoints: Endpoints;
  email: string;
  clientId: string;
  clientSecret: string;
  deviceId: string;
}

const DEVICE_TYPE = "14"; // DeviceType.UnknownBrowser
// The identity server rejects token requests without this header (version_header_missing).
// Accounts on v2 encryption need >= 2025.11.0; we only decrypt v1 (AES-CBC), so we honestly
// claim an older client and such accounts get invalid_client_version instead of undecryptable data.
const CLIENT_HEADERS = { "Bitwarden-Client-Name": "obsidian", "Bitwarden-Client-Version": "2025.10.0" };
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEFAULT_KDF: KdfConfig = { type: 0, iterations: 600_000, memory: 64, parallelism: 4 };

export function endpoints(s: Pick<BitwardenPluginSettings, "region" | "serverUrl">): Endpoints {
  if (s.region === "self") {
    const base = s.serverUrl.replace(/\/+$/, "");
    return { identity: `${base}/identity`, api: `${base}/api` };
  }
  const domain = s.region === "eu" ? "bitwarden.eu" : "bitwarden.com";
  return { identity: `https://identity.${domain}`, api: `https://api.${domain}` };
}

interface Body {
  json?: unknown;
  form?: Record<string, string>;
}

function send(method: "GET" | "POST", url: string, body: Body = {}, headers: Record<string, string> = {}): Promise<RequestUrlResponse> {
  const contentType = body.json !== undefined ? "application/json" : body.form ? "application/x-www-form-urlencoded; charset=utf-8" : undefined;
  return requestUrl({
    url,
    method,
    headers: { ...CLIENT_HEADERS, Accept: "application/json", ...(contentType ? { "Content-Type": contentType } : {}), ...headers },
    body: body.json !== undefined ? JSON.stringify(body.json) : body.form ? new URLSearchParams(body.form).toString() : undefined,
    throw: false,
  });
}

// OAuth error from /connect/token, e.g. ": invalid_client" or ": invalid_grant - <server message>".
// These are server-generated codes/messages and never echo the submitted secret.
function oauthErrorSuffix(body: string): string {
  let e: { error?: unknown; error_description?: unknown; errorModel?: { message?: unknown } };
  try {
    e = camelize(JSON.parse(body));
  } catch {
    return "";
  }
  const reason = [e.error, e.errorModel?.message ?? e.error_description]
    .filter((p): p is string => typeof p === "string" && p !== "")
    .join(" - ");
  return reason ? `: ${reason}` : "";
}

export class BitwardenApi {
  private readonly credentials: () => Credentials;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  // Bumped by clearToken(); a login that started before the bump must not store its token.
  private epoch = 0;

  // credentials is read on every request so settings changes apply without re-creating the client
  constructor(credentials: () => Credentials) {
    this.credentials = credentials;
  }

  clearToken(): void {
    this.epoch++;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async prelogin(): Promise<KdfConfig> {
    const { endpoints: ep, email } = this.credentials();
    // bitwarden.com serves prelogin from identity; some self-hosted versions only from api.
    for (const base of [ep.identity, ep.api]) {
      const res = await send("POST", `${base}/accounts/prelogin`, { json: { email } });
      if (res.status === 404 || res.status === 405) continue;
      if (res.status !== 200) throw new Error(`PRELOGIN_FAILED_${res.status}`);
      const k = camelize<{ kdf?: number; kdfIterations?: number; kdfMemory?: number; kdfParallelism?: number }>(res.json);
      return checkKdf({
        type: k.kdf ?? DEFAULT_KDF.type,
        iterations: k.kdfIterations ?? DEFAULT_KDF.iterations,
        memory: k.kdfMemory ?? DEFAULT_KDF.memory,
        parallelism: k.kdfParallelism ?? DEFAULT_KDF.parallelism,
      });
    }
    throw new Error("PRELOGIN_FAILED");
  }

  // Personal API key login (OAuth client_credentials).
  private async login(): Promise<string> {
    const c = this.credentials();
    const epoch = this.epoch;
    const res = await send("POST", `${c.endpoints.identity}/connect/token`, {
      form: {
        grant_type: "client_credentials",
        scope: "api",
        client_id: c.clientId,
        client_secret: c.clientSecret,
        deviceType: DEVICE_TYPE,
        deviceIdentifier: c.deviceId,
        deviceName: "obsidian",
      },
    }, { "Device-Type": DEVICE_TYPE });
    if (res.status !== 200) throw new Error(`LOGIN_FAILED_${res.status}${oauthErrorSuffix(res.text)}`);
    if (epoch !== this.epoch) throw new Error("LOCKED"); // locked while logging in
    const { access_token: token, expires_in: ttl } = res.json as { access_token: string; expires_in?: number };
    this.token = token;
    this.tokenExpiresAt = Date.now() + (ttl ?? 3600) * 1000;
    return token;
  }

  private async validToken(): Promise<string> {
    const fresh = this.token && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS;
    return fresh ? this.token! : this.login();
  }

  // The raw, still encrypted /sync payload. Retries once with a new token if the old one was revoked.
  async sync(): Promise<unknown> {
    const url = `${this.credentials().endpoints.api}/sync?excludeDomains=true`;
    const get = (token: string) => send("GET", url, {}, { Authorization: `Bearer ${token}` });
    let res = await get(await this.validToken());
    if (res.status === 401) {
      this.clearToken();
      res = await get(await this.login());
    }
    if (res.status !== 200) throw new Error(`SYNC_FAILED_${res.status}`);
    return res.json;
  }
}
