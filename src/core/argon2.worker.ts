// Web Worker entry: runs Argon2 off the UI thread. Bundled as an inline string (see esbuild.config.mjs).

import { argon2, type Argon2Params } from "./argon2.ts";

export interface Argon2Request {
  password: Uint8Array;
  salt: Uint8Array;
  params: Argon2Params;
}

self.onmessage = (e: MessageEvent<Argon2Request>) => {
  const { password, salt, params } = e.data;
  try {
    self.postMessage({ tag: argon2(password, salt, params) });
  } catch (err) {
    self.postMessage({ error: String(err) });
  } finally {
    password.fill(0); // this structured-clone copy belongs to the worker
  }
};
