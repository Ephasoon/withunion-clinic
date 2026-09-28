import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { describeApiError } from "./errorMessages";

describe("describeApiError", () => {
  it("VALIDATION_ERROR: body/query failures point to the fields", () => {
    expect(describeApiError(new ApiError(400, "VALIDATION_ERROR", "Invalid request body", {}))).toMatch(
      /highlighted fields/
    );
  });

  it("VALIDATION_ERROR: a malformed path id means a bad link", () => {
    expect(describeApiError(new ApiError(400, "VALIDATION_ERROR", "Invalid id format"))).toBe(
      "This link does not point to a valid record."
    );
    expect(describeApiError(new ApiError(400, "VALIDATION_ERROR", "Invalid visit id format"))).toBe(
      "This link does not point to a valid record."
    );
  });

  it("VALIDATION_ERROR: service rules keep the backend message", () => {
    expect(describeApiError(new ApiError(400, "VALIDATION_ERROR", "reason is required to cancel a visit"))).toBe(
      "reason is required to cancel a visit"
    );
  });

  it("NOT_FOUND: uses the page's wording when given, else the backend's", () => {
    const error = new ApiError(404, "NOT_FOUND", "Patient not found");
    expect(describeApiError(error, { notFound: "This patient record does not exist." })).toBe(
      "This patient record does not exist."
    );
    expect(describeApiError(error)).toBe("Patient not found");
  });

  it("VISIT_TERMINAL, FORBIDDEN and INTERNAL_ERROR have friendly text", () => {
    expect(describeApiError(new ApiError(409, "VISIT_TERMINAL", "Visit is already CANCELLED"))).toMatch(
      /completed or cancelled/
    );
    expect(describeApiError(new ApiError(403, "FORBIDDEN", "Your role cannot move a visit from X to Y"))).toMatch(
      /not allowed/
    );
    expect(describeApiError(new ApiError(500, "INTERNAL_ERROR", "Something went wrong."))).toMatch(/on the server/);
  });

  it("covers network failures, other 5xx and non-ApiErrors", () => {
    expect(describeApiError(new ApiError(0, "NETWORK_ERROR", "x"))).toMatch(/reach the server/);
    expect(describeApiError(new ApiError(502, "HTTP_ERROR", "Request failed with status 502."))).toMatch(/not responding/);
    expect(describeApiError(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
