import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { deriveAuthState, isSessionExpiredError } from "./authState";
import type { AuthUser } from "./types";

const user: AuthUser = { id: "u1", fullName: "Amina Tesfaye", username: "amina", role: "reception", isActive: true };

describe("deriveAuthState", () => {
  it("is loading while /auth/me has not answered", () => {
    expect(deriveAuthState({ status: "pending", data: undefined, error: null })).toEqual({ status: "loading" });
  });

  it("is authenticated with the user when /auth/me returned one", () => {
    expect(deriveAuthState({ status: "success", data: user, error: null })).toEqual({
      status: "authenticated",
      user,
    });
  });

  it("is unauthenticated when /auth/me resolved to null (401)", () => {
    expect(deriveAuthState({ status: "success", data: null, error: null })).toEqual({ status: "unauthenticated" });
  });

  it("is error — not unauthenticated — when /auth/me could not be answered", () => {
    const error = new ApiError(0, "NETWORK_ERROR", "down");
    expect(deriveAuthState({ status: "error", data: undefined, error })).toEqual({ status: "error", error });
  });

  it("keeps a known user when a later refetch fails", () => {
    const error = new ApiError(502, "HTTP_ERROR", "bad gateway");
    expect(deriveAuthState({ status: "error", data: user, error })).toEqual({ status: "authenticated", user });
  });
});

describe("isSessionExpiredError", () => {
  it("is true for 401 UNAUTHENTICATED", () => {
    expect(isSessionExpiredError(new ApiError(401, "UNAUTHENTICATED", "You must be logged in"))).toBe(true);
  });

  it("is false for login's 401 INVALID_CREDENTIALS", () => {
    expect(isSessionExpiredError(new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password"))).toBe(false);
  });

  it("is false for 403, other errors, and non-ApiErrors", () => {
    expect(isSessionExpiredError(new ApiError(403, "FORBIDDEN", "no"))).toBe(false);
    expect(isSessionExpiredError(new ApiError(500, "INTERNAL_ERROR", "x"))).toBe(false);
    expect(isSessionExpiredError(new Error("x"))).toBe(false);
  });
});
