import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { describeApiError, patientPhoneConflict, patientPhoneConflictMessage } from "./errorMessages";

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

  it("INVALID_VISIT_STATE says the visit is no longer at this step", () => {
    expect(
      describeApiError(new ApiError(409, "INVALID_VISIT_STATE", "Vitals can only be recorded while the visit is WITH_NURSE"))
    ).toMatch(/no longer at this step/);
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

describe("PATIENT_PHONE_ALREADY_EXISTS", () => {
  const details = { patientId: "p-1", patientCode: "WU-007005", fullName: "Desta Ledamo" };
  const error = new ApiError(409, "PATIENT_PHONE_ALREADY_EXISTS", "This phone number already belongs to …", details);

  it("names the patient who already has the number", () => {
    expect(describeApiError(error)).toBe("This phone number already belongs to Desta Ledamo (WU-007005)");
    expect(patientPhoneConflictMessage(details)).toBe("This phone number already belongs to Desta Ledamo (WU-007005)");
  });

  it("reads the existing patient from the details", () => {
    expect(patientPhoneConflict(error)).toEqual(details);
  });

  it("falls back to generic text when the details are missing or malformed", () => {
    const bare = new ApiError(409, "PATIENT_PHONE_ALREADY_EXISTS", "x", null);
    expect(describeApiError(bare)).toBe("This phone number already belongs to another patient.");
    expect(patientPhoneConflict(bare)).toBeNull();
    expect(patientPhoneConflict(new ApiError(409, "PATIENT_PHONE_ALREADY_EXISTS", "x", { patientId: 1 }))).toBeNull();
  });

  it("is null for other errors", () => {
    expect(patientPhoneConflict(new ApiError(409, "PRICE_LIST_ITEM_ALREADY_EXISTS", "x", details))).toBeNull();
    expect(patientPhoneConflict(new Error("boom"))).toBeNull();
  });
});
