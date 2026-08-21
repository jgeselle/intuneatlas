import assert from "node:assert/strict";
import { test } from "node:test";
import { identityFromAccount } from "../../src/auth/webSession.js";

// Minimal shape identityFromAccount actually reads — not the full
// @azure/msal-node AccountInfo type, which carries a lot more than this.
function account(overrides: { localAccountId: string; name?: string; username: string; roles?: string[] }) {
  return {
    localAccountId: overrides.localAccountId,
    name: overrides.name,
    username: overrides.username,
    idTokenClaims: overrides.roles ? { roles: overrides.roles } : undefined,
  } as unknown as Parameters<typeof identityFromAccount>[0];
}

test("identityFromAccount: id comes from localAccountId (the oid claim), not the display name", () => {
  const identity = identityFromAccount(account({ localAccountId: "oid-123", name: "Jan Janssen", username: "jan@contoso.com" }));
  assert.equal(identity.id, "oid-123");
  assert.equal(identity.name, "Jan Janssen");
  assert.notEqual(identity.id, identity.name);
});

test("identityFromAccount: two users sharing a display name resolve to different ids", () => {
  // The exact scenario the display-name-keyed ownership bug allowed: two
  // real people named "Jan Janssen" in the same tenant must not collide.
  const jan1 = identityFromAccount(account({ localAccountId: "oid-aaa", name: "Jan Janssen", username: "jan1@contoso.com" }));
  const jan2 = identityFromAccount(account({ localAccountId: "oid-bbb", name: "Jan Janssen", username: "jan2@contoso.com" }));
  assert.equal(jan1.name, jan2.name);
  assert.notEqual(jan1.id, jan2.id);
});

test("identityFromAccount: renaming a user (name changes) doesn't change id", () => {
  const before = identityFromAccount(account({ localAccountId: "oid-123", name: "Jan Janssen", username: "jan@contoso.com" }));
  const after = identityFromAccount(account({ localAccountId: "oid-123", name: "Jan Something-Else", username: "jan@contoso.com" }));
  assert.equal(before.id, after.id);
  assert.notEqual(before.name, after.name);
});

test("identityFromAccount: falls back to username for name when Entra doesn't supply one, but id is always localAccountId", () => {
  const identity = identityFromAccount(account({ localAccountId: "oid-123", username: "jan@contoso.com" }));
  assert.equal(identity.name, "jan@contoso.com");
  assert.equal(identity.id, "oid-123");
});

test("identityFromAccount: role resolves from idTokenClaims.roles", () => {
  assert.equal(identityFromAccount(account({ localAccountId: "oid-1", username: "a@x.com", roles: ["admin"] })).role, "admin");
  assert.equal(identityFromAccount(account({ localAccountId: "oid-1", username: "a@x.com" })).role, null);
});
