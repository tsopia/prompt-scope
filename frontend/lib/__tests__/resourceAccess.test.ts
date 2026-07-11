import { describe, expect, it } from "vitest";
import { canManageResource } from "@/lib/resourceAccess";

// Mirrors the backend policy in backend/services/authz.assert_resource_manager:
// a provider/pricing row's edit/delete controls are enabled only for the
// row's creator or a project owner. Legacy rows (created_by null) fall
// through to owner-only.

describe("canManageResource", () => {
  it("allows the creator to manage their own row", () => {
    expect(canManageResource("user-a", false, "user-a")).toBe(true);
  });

  it("blocks another ordinary member who did not create the row", () => {
    expect(canManageResource("user-a", false, "user-b")).toBe(false);
  });

  it("allows an owner to manage any row, including one they didn't create", () => {
    expect(canManageResource("user-a", true, "user-b")).toBe(true);
  });

  it("blocks a non-owner member on a legacy row with created_by null", () => {
    expect(canManageResource(null, false, "user-b")).toBe(false);
  });

  it("allows an owner to manage a legacy row with created_by null", () => {
    expect(canManageResource(null, true, "user-b")).toBe(true);
  });

  it("blocks when userId is undefined (not yet loaded) and not owner", () => {
    expect(canManageResource("user-a", false, undefined)).toBe(false);
  });
});
