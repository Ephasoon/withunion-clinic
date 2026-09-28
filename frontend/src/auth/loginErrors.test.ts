import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { loginErrorMessage } from "./loginErrors";

describe("loginErrorMessage", () => {
  it("maps each backend login error to user-facing text", () => {
    expect(loginErrorMessage(new ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password"))).toBe(
      "Incorrect username or password."
    );
    expect(loginErrorMessage(new ApiError(429, "RATE_LIMITED", "Too many login attempts."))).toMatch(/Too many/);
    expect(loginErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Invalid request body"))).toMatch(/username and password/);
  });

  it("explains an unreachable or failing server", () => {
    expect(loginErrorMessage(new ApiError(0, "NETWORK_ERROR", "x"))).toMatch(/reach the server/);
    expect(loginErrorMessage(new ApiError(502, "HTTP_ERROR", "Request failed with status 502."))).toMatch(/not responding/);
  });

  it("has a generic fallback for non-ApiErrors", () => {
    expect(loginErrorMessage(new Error("boom"))).toBe("Sign-in failed. Please try again.");
  });
});
