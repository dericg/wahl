import test from "node:test";
import assert from "node:assert/strict";
import { performPasskey, supportsPasskeys } from "../src/passkey.js";

test("passkeys require a secure context and both credential APIs", () => {
  const supported = { isSecureContext: true, PublicKeyCredential: class {}, navigator: { credentials: { get() {}, create() {} } } };
  assert.equal(supportsPasskeys(supported), true);
  assert.equal(supportsPasskeys({}), false);
  assert.equal(supportsPasskeys({ ...supported, isSecureContext: false }), false);
  assert.equal(supportsPasskeys({ ...supported, PublicKeyCredential: undefined }), false);
  assert.equal(supportsPasskeys({ ...supported, navigator: { credentials: { get() {} } } }), false);
});

test("sign-in delegates session verification to Supabase and forwards cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const auth = { async signInWithPasskey({ options }) {
    calls++;
    assert.equal(options.signal, controller.signal);
    return { data: { session: { user: { id: "existing-owner" } } }, error: null };
  } };
  assert.equal(await performPasskey(auth, { signal: controller.signal }), "");
  assert.equal(calls, 1);
});

test("enrollment requires a signed-in owner and registers on the existing session", async () => {
  let calls = 0;
  const auth = { async registerPasskey() { calls++; return { data: { id: "credential" }, error: null }; } };
  for (const state of [{}, { owner: true }, { session: { user: { id: "visitor" } }, owner: false }]) {
    assert.match(await performPasskey(auth, { register: true, ...state }), /Owner access is required/);
  }
  assert.equal(calls, 0);
  assert.match(await performPasskey(auth, { register: true, owner: true, session: { user: { id: "owner" } } }), /Passkey added/);
  assert.equal(calls, 1);
});

test("cancelled, unavailable, rejected and incomplete sign-ins preserve a recovery path", async () => {
  for (const method of [
    async () => ({ data: null, error: { message: "server detail" } }),
    async () => { throw new DOMException("cancelled", "NotAllowedError"); },
    async () => { throw new Error("network failed"); },
    async () => ({ data: null, error: null }),
    async () => ({ data: { user: {} }, error: null }),
  ]) {
    assert.equal(await performPasskey({ signInWithPasskey: method }), "Passkey sign-in wasn’t completed. Try again or use your password.");
  }
});

test("failed enrollment never reports that a passkey was added", async () => {
  for (const method of [
    async () => ({ data: null, error: { message: "disabled" } }),
    async () => { throw new DOMException("cancelled", "NotAllowedError"); },
    async () => ({ data: null, error: null }),
  ]) {
    assert.equal(await performPasskey({ registerPasskey: method }, { register: true, owner: true, session: {} }),
      "Passkey wasn’t added. You can try again; password sign-in is still available.");
  }
});
