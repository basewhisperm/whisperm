import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthError,
  hasPermission,
  marketplaceAcquisitionPermissions,
  requirePermission,
} from "../dist/index.js";

const marketplacePermission = {
  read: "marketplace_acquisition.read",
  capture: "marketplace_acquisition.capture",
  invite: "marketplace_acquisition.invite",
  verify: "marketplace_acquisition.verify",
  convert: "marketplace_acquisition.convert",
  configure: "marketplace_acquisition.configure",
};

test("OWNER has all Marketplace Acquisition permissions", () => {
  for (const permission of marketplaceAcquisitionPermissions) {
    assert.equal(hasPermission("OWNER", permission), true, permission);
    assert.doesNotThrow(() => requirePermission("OWNER", permission));
  }
});

test("ADMIN can verify and convert, but cannot configure", () => {
  assert.equal(hasPermission("ADMIN", marketplacePermission.verify), true);
  assert.equal(hasPermission("ADMIN", marketplacePermission.convert), true);
  assert.equal(hasPermission("ADMIN", marketplacePermission.configure), false);

  assert.throws(
    () => requirePermission("ADMIN", marketplacePermission.configure),
    (error) => error instanceof AuthError && error.code === "AUTH_FORBIDDEN"
  );
});

test("MEMBER can read, capture, and invite", () => {
  assert.equal(hasPermission("MEMBER", marketplacePermission.read), true);
  assert.equal(hasPermission("MEMBER", marketplacePermission.capture), true);
  assert.equal(hasPermission("MEMBER", marketplacePermission.invite), true);
});

test("VIEWER cannot capture, invite, verify, convert, or configure", () => {
  for (const permission of [
    marketplacePermission.capture,
    marketplacePermission.invite,
    marketplacePermission.verify,
    marketplacePermission.convert,
    marketplacePermission.configure,
  ]) {
    assert.equal(hasPermission("VIEWER", permission), false, permission);
  }
});

test("unknown permissions fail closed", () => {
  const unknownPermission = "marketplace_acquisition.destroy";

  assert.equal(hasPermission("OWNER", unknownPermission), false);
  assert.throws(
    () => requirePermission("OWNER", unknownPermission),
    (error) => error instanceof AuthError && error.code === "AUTH_FORBIDDEN"
  );
});

test("unknown roles fail closed", () => {
  assert.equal(hasPermission("SUPER_ADMIN", marketplacePermission.read), false);
  assert.throws(
    () => requirePermission("SUPER_ADMIN", marketplacePermission.read),
    (error) => error instanceof AuthError && error.code === "AUTH_FORBIDDEN"
  );
});
