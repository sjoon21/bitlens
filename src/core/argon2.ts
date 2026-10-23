// Argon2id via @noble/hashes, shared by the Web Worker and the main-thread fallback.

import { argon2id } from "@noble/hashes/argon2.js";
import type { Bytes } from "../types.ts";

export interface Argon2Params {
  iterations: number;
  memoryKiB: number;
  parallelism: number;
}

export function argon2(password: Uint8Array, salt: Uint8Array, p: Argon2Params): Bytes {
  return argon2id(password, salt, {
    t: p.iterations,
    m: p.memoryKiB,
    p: p.parallelism,
    dkLen: 32,
    maxmem: p.memoryKiB * 1024 * 2, // the 1 GiB default would reject Bitwarden's 1024 MiB maximum
  }) as Bytes;
}
