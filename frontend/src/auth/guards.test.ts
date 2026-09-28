import { describe, expect, it } from "vitest";
import type { AuthState } from "./authState";
import { decideAuthGuard, decideGuestGuard, safeRedirectPath, shouldSaveReturnPath } from "./guards";

const loading: AuthState = { status: "loading" };
const error: AuthState = { status: "error", error: new Error("down") };
const signedOut: AuthState = { status: "unauthenticated" };
const signedIn: AuthState = {
  status: "authenticated",
  user: { id: "u1", fullName: "A", username: "a", role: "doctor", isActive: true },
};

describe("decideAuthGuard (authenticated area)", () => {
  it("waits, errors, allows, or redirects to login by auth state", () => {
    expect(decideAuthGuard(loading)).toBe("wait");
    expect(decideAuthGuard(error)).toBe("error");
    expect(decideAuthGuard(signedIn)).toBe("allow");
    expect(decideAuthGuard(signedOut)).toBe("redirect");
  });
});

describe("decideGuestGuard (login page)", () => {
  it("allows signed-out users and redirects signed-in ones", () => {
    expect(decideGuestGuard(loading)).toBe("wait");
    expect(decideGuestGuard(error)).toBe("error");
    expect(decideGuestGuard(signedOut)).toBe("allow");
    expect(decideGuestGuard(signedIn)).toBe("redirect");
  });
});

describe("shouldSaveReturnPath", () => {
  it("does not remember the page after a deliberate sign-out, confirmed or not", () => {
    expect(shouldSaveReturnPath("logout")).toBe(false);
    expect(shouldSaveReturnPath("logout-failed")).toBe(false);
  });

  it("remembers the page after an expired session or a fresh visit", () => {
    expect(shouldSaveReturnPath("expired")).toBe(true);
    expect(shouldSaveReturnPath(null)).toBe(true);
  });
});

describe("safeRedirectPath", () => {
  it("returns a saved in-app location with its search and hash", () => {
    expect(safeRedirectPath({ pathname: "/visits/1", search: "?tab=lab", hash: "#top" })).toBe("/visits/1?tab=lab#top");
    expect(safeRedirectPath("/patients")).toBe("/patients");
  });

  it("falls back to home when nothing usable was saved", () => {
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath({})).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  it("never redirects off-site", () => {
    expect(safeRedirectPath("//evil.example")).toBe("/");
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("https://evil.example/")).toBe("/");
    expect(safeRedirectPath({ pathname: "//evil.example" })).toBe("/");
  });

  it("never redirects back to the login page", () => {
    expect(safeRedirectPath("/login")).toBe("/");
    expect(safeRedirectPath({ pathname: "/login", search: "?x=1" })).toBe("/");
  });
});
