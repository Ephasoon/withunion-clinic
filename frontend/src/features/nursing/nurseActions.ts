import { ROLES } from "../../rbac/roles";
import type { Visit, VisitStatus } from "../visits/types";

/** The statuses that belong to nursing, in queue order. */
export const NURSE_QUEUE_STATUSES = ["WAITING_FOR_NURSE", "WITH_NURSE"] as const satisfies readonly VisitStatus[];

export interface NurseActions {
  /** WAITING_FOR_NURSE → WITH_NURSE through the generic transition (the only path, docs §3.3). */
  canPickUp: boolean;
  /** POST /visits/:id/vitals — only while WITH_NURSE. */
  canRecordVitals: boolean;
  /** POST /visits/:id/nursing-assessment — only while WITH_NURSE; it also advances to WAITING_FOR_DOCTOR. */
  canRecordAssessment: boolean;
}

const NONE: NurseActions = { canPickUp: false, canRecordVitals: false, canRecordAssessment: false };

/**
 * What a user with `role` may do on the nursing page for a visit in
 * `status`. Only nurses act; the owner (and anyone else) may only view.
 * There is deliberately no WITH_NURSE → WAITING_FOR_DOCTOR action: the
 * visit leaves nursing only by recording the assessment.
 */
export function allowedNurseActions(role: string, status: VisitStatus): NurseActions {
  if (role !== ROLES.NURSE) return NONE;
  if (status === "WAITING_FOR_NURSE") return { ...NONE, canPickUp: true };
  if (status === "WITH_NURSE") return { canPickUp: false, canRecordVitals: true, canRecordAssessment: true };
  return NONE;
}

/**
 * The nurse queue from GET /visits/today, split by step. The backend
 * already limits a nurse's list to these two statuses (§3.4); the owner
 * gets every status, so the list is filtered here as well. Order is kept
 * (created_at ASC — oldest first).
 */
export function splitNurseQueue(visits: readonly Visit[]): { waiting: Visit[]; withNurse: Visit[] } {
  return {
    waiting: visits.filter((v) => v.status === "WAITING_FOR_NURSE"),
    withNurse: visits.filter((v) => v.status === "WITH_NURSE"),
  };
}

/**
 * Follow-up text after POST /nursing-assessment failed, once the visit
 * and assessment have been re-fetched. The backend saves the assessment
 * and then moves the visit in two steps (not one transaction), so a
 * failure can leave the assessment saved while the visit stays WITH_NURSE.
 */
export function assessmentFailureFollowUp(visitStatus: VisitStatus, hasSavedAssessment: boolean): string | null {
  if (visitStatus === "WITH_NURSE") {
    return hasSavedAssessment
      ? "The assessment was saved, but the visit was not sent to the doctor. Check it and submit again to send it."
      : null;
  }
  if (visitStatus === "WAITING_FOR_DOCTOR") return "The visit has already been sent to the doctor.";
  return "This visit is no longer with nursing, so the assessment cannot be changed here.";
}
