import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError } from "../src/ui/errors.ts";

test("describeError surfaces the server's reason for a rejected API key", () => {
  assert.equal(
    describeError(new Error("LOGIN_FAILED_400: invalid_client")),
    "The API key was rejected (invalid_client). Check client_id and client_secret.",
  );
  assert.equal(
    describeError(new Error("LOGIN_FAILED_401")),
    "The API key was rejected. Check client_id and client_secret.",
  );
});

test("describeError explains accounts on Bitwarden's v2 encryption", () => {
  assert.match(
    describeError(new Error("LOGIN_FAILED_400: invalid_client_version - Please update your app to continue using Bitwarden")),
    /newer encryption/,
  );
});

test("describeError maps known codes and falls back for unknown ones", () => {
  assert.equal(describeError(new Error("MAC_FAILED")), "Wrong master password.");
  assert.equal(describeError(new Error("SYNC_FAILED_500")), "Bitwarden server error (SYNC_FAILED_500).");
  assert.equal(describeError("boom"), "Unexpected error: boom");
});
