import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import type { VisitStatus } from "../visits/types";

/**
 * FORBIDDEN means two different things on consultation writes (docs §5.6, §6):
 * - "You can only modify your own consultation record" — not this doctor's consultation;
 * - "Your role cannot move a visit from X to …" — on complete, the visit is no longer WITH_DOCTOR.
 */
export function isNotOwnConsultationError(error: unknown): boolean {
  return isApiError(error) && error.code === "FORBIDDEN" && /own consultation record/i.test(error.message);
}

export function isVisitMovedError(error: unknown): boolean {
  return isApiError(error) && error.code === "FORBIDDEN" && /cannot move a visit/i.test(error.message);
}

/** User-facing text for a failed write on an existing consultation (notes, diagnosis, orders, prescription). */
export function consultationWriteErrorMessage(error: unknown): string {
  if (isNotOwnConsultationError(error)) return "Only the doctor who opened this consultation can change it.";
  if (isApiError(error) && error.code === "CONSULTATION_COMPLETED") {
    return "This consultation has already been completed, so it can no longer be changed.";
  }
  return describeApiError(error, { notFound: "This consultation no longer exists." });
}

/**
 * User-facing text for a failed POST /consultations/:id/complete.
 * VISIT_TERMINAL, or FORBIDDEN "cannot move a visit", means the visit
 * left WITH_DOCTOR while the consultation was open — in practice it was
 * cancelled. `currentStatus` (re-fetched) sharpens the message when known.
 */
export function completionErrorMessage(error: unknown, currentStatus: VisitStatus | null): string {
  const visitMoved = (isApiError(error) && error.code === "VISIT_TERMINAL") || isVisitMovedError(error);
  if (visitMoved) {
    if (currentStatus === null || currentStatus === "CANCELLED") {
      return "This visit was cancelled while you were working on it.";
    }
    return `This visit is no longer with the doctor (it is now ${currentStatus}), so the consultation cannot be completed.`;
  }
  return consultationWriteErrorMessage(error);
}

/** User-facing text for a failed POST /visits/:id/consultations. */
export function openConsultationErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === "CONSULTATION_ALREADY_OPEN") {
    return "This visit already has an open consultation. Complete it before opening another.";
  }
  return describeApiError(error, { notFound: "This visit does not exist." });
}
