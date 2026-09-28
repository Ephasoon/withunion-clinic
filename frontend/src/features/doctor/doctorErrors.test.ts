import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import {
  completionErrorMessage,
  consultationWriteErrorMessage,
  isNotOwnConsultationError,
  isVisitMovedError,
  openConsultationErrorMessage,
} from "./doctorErrors";

// Messages verbatim from docs/api-inventory.md §5.6 and §6.
const notOwn = new ApiError(403, "FORBIDDEN", "You can only modify your own consultation record");
const moved = new ApiError(403, "FORBIDDEN", "Your role cannot move a visit from CANCELLED to WAITING_FOR_BILLING");
const terminal = new ApiError(409, "VISIT_TERMINAL", "Visit is already CANCELLED and cannot be changed further");
const completed = new ApiError(409, "CONSULTATION_COMPLETED", "This consultation has already been completed");
const alreadyOpen = new ApiError(
  409,
  "CONSULTATION_ALREADY_OPEN",
  "This visit already has an open consultation — complete it before opening another"
);

describe("telling the two FORBIDDENs apart", () => {
  it("recognises 'not your consultation' and 'visit moved on'", () => {
    expect(isNotOwnConsultationError(notOwn)).toBe(true);
    expect(isNotOwnConsultationError(moved)).toBe(false);
    expect(isVisitMovedError(moved)).toBe(true);
    expect(isVisitMovedError(notOwn)).toBe(false);
    expect(isVisitMovedError(new ApiError(403, "FORBIDDEN", "You do not have access to this resource"))).toBe(false);
  });
});

describe("consultationWriteErrorMessage", () => {
  it("FORBIDDEN (not own): only the consultation's doctor can change it", () => {
    expect(consultationWriteErrorMessage(notOwn)).toBe("Only the doctor who opened this consultation can change it.");
  });

  it("CONSULTATION_COMPLETED: already completed", () => {
    expect(consultationWriteErrorMessage(completed)).toMatch(/already been completed/);
  });

  it("NOT_FOUND: the consultation no longer exists", () => {
    expect(consultationWriteErrorMessage(new ApiError(404, "NOT_FOUND", "Consultation not found"))).toBe(
      "This consultation no longer exists."
    );
  });

  it("falls back to the shared messages", () => {
    expect(consultationWriteErrorMessage(new ApiError(0, "NETWORK_ERROR", "x"))).toMatch(/reach the server/);
  });
});

describe("completionErrorMessage", () => {
  it("VISIT_TERMINAL: the visit was cancelled while the doctor was working", () => {
    expect(completionErrorMessage(terminal, "CANCELLED")).toBe("This visit was cancelled while you were working on it.");
    expect(completionErrorMessage(terminal, null)).toBe("This visit was cancelled while you were working on it.");
  });

  it("FORBIDDEN 'cannot move a visit': the same message when the visit is cancelled", () => {
    expect(completionErrorMessage(moved, "CANCELLED")).toBe("This visit was cancelled while you were working on it.");
  });

  it("names the real status when the visit moved somewhere other than CANCELLED", () => {
    expect(completionErrorMessage(moved, "WAITING_FOR_BILLING")).toMatch(/now WAITING_FOR_BILLING/);
  });

  it("keeps the ownership and completed messages", () => {
    expect(completionErrorMessage(notOwn, "WITH_DOCTOR")).toBe(
      "Only the doctor who opened this consultation can change it."
    );
    expect(completionErrorMessage(completed, "WAITING_FOR_LAB")).toMatch(/already been completed/);
  });
});

describe("openConsultationErrorMessage", () => {
  it("CONSULTATION_ALREADY_OPEN: explains and points at the open one", () => {
    expect(openConsultationErrorMessage(alreadyOpen)).toMatch(/already has an open consultation/);
  });

  it("INVALID_VISIT_STATE: the visit is no longer at this step", () => {
    expect(openConsultationErrorMessage(new ApiError(409, "INVALID_VISIT_STATE", "x"))).toMatch(/no longer at this step/);
  });
});
