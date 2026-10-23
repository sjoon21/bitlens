// Runs Argon2 in a one-shot Web Worker so a 64 MiB derivation doesn't freeze Obsidian.

import type { Bytes } from "../types.ts";
import { argon2, type Argon2Params } from "./argon2.ts";
import type { Argon2Request } from "./argon2.worker.ts";
import workerSource from "./argon2.worker.ts?worker";

function startWorker(): Worker | null {
  const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
  try {
    return new Worker(url);
  } catch {
    return null; // workers unavailable (e.g. restrictive WebView): caller falls back to the UI thread
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function argon2InWorker(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<Bytes> {
  const worker = startWorker();
  if (!worker) return Promise.resolve(argon2(password, salt, params));
  return new Promise<Bytes>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ tag?: Bytes; error?: string }>) => {
      worker.terminate();
      if (e.data.tag) resolve(e.data.tag);
      else reject(new Error(e.data.error ?? "ARGON2_FAILED"));
    };
    // The worker script failed to load or crashed (e.g. a WebView blocking blob: workers): fall back.
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      try {
        resolve(argon2(password, salt, params));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    const req: Argon2Request = { password, salt, params };
    worker.postMessage(req);
  });
}
