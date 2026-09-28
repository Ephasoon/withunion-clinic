import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import type { AuthState } from "../auth/authState";
import { hasRole, isForbiddenError, isRoleAllowed } from "./access";
import { decideRoleGuard } from "./guards";
import { ALL_ROLES, isRole, roleLabel, ROLES } from "./roles";

const signedInAs = (role: string): AuthState => ({
  status: "authenticated",
  user: { id: "u1", fullName: "A", username: "a", role, isActive: true },
});

describe("roles", () => {
  it("mirrors exactly the six backend roles", () => {
    expect([...ALL_ROLES].sort()).toEqual(["doctor", "lab_tech", "nurse", "owner", "pharmacy", "reception"]);
  });

  it("recognises only those roles", () => {
    expect(isRole("lab_tech")).toBe(true);
    expect(isRole("admin")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("labels known roles and passes unknown ones through", () => {
    expect(roleLabel("lab_tech")).toBe("Lab technician");
    expect(roleLabel("auditor")).toBe("auditor");
  });
});

describe("isRoleAllowed / hasRole", () => {
  it("allows a listed role and rejects an unlisted one", () => {
    expect(isRoleAllowed("reception", [ROLES.RECEPTION, ROLES.OWNER])).toBe(true);
    expect(isRoleAllowed("nurse", [ROLES.RECEPTION, ROLES.OWNER])).toBe(false);
  });

  it("fails closed for an unknown role, a missing role, or no user", () => {
    expect(isRoleAllowed("admin", ALL_ROLES)).toBe(false);
    expect(isRoleAllowed(undefined, ALL_ROLES)).toBe(false);
    expect(hasRole(null, ROLES.OWNER)).toBe(false);
  });

  it("checks a user's role", () => {
    expect(hasRole({ role: "owner" }, ROLES.OWNER)).toBe(true);
    expect(hasRole({ role: "doctor" }, ROLES.OWNER, ROLES.RECEPTION)).toBe(false);
  });
});

describe("decideRoleGuard", () => {
  it("allows an authenticated user with an allowed role", () => {
    expect(decideRoleGuard(signedInAs("pharmacy"), [ROLES.PHARMACY, ROLES.OWNER])).toBe("allow");
  });

  it("forbids an authenticated user whose role is not allowed", () => {
    expect(decideRoleGuard(signedInAs("doctor"), [ROLES.RECEPTION])).toBe("forbidden");
  });

  it("forbids anything that is not an authenticated, allowed user", () => {
    expect(decideRoleGuard({ status: "loading" }, ALL_ROLES)).toBe("forbidden");
    expect(decideRoleGuard({ status: "unauthenticated" }, ALL_ROLES)).toBe("forbidden");
    expect(decideRoleGuard(signedInAs("admin"), ALL_ROLES)).toBe("forbidden");
  });
});

describe("isForbiddenError", () => {
  it("is true only for a 403 ApiError", () => {
    expect(isForbiddenError(new ApiError(403, "FORBIDDEN", "no"))).toBe(true);
    expect(isForbiddenError(new ApiError(401, "UNAUTHENTICATED", "no"))).toBe(false);
    expect(isForbiddenError(new Error("403"))).toBe(false);
  });
});
