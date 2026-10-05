import { ROLES } from "../../rbac/roles";
import { TERMINAL_STATUSES, type Visit, type VisitStatus } from "./types";

export type VisitAction =
  | { kind: "send"; toStatus: "WAITING_FOR_NURSE"; label: string }
  | { kind: "send"; toStatus: "WAITING_FOR_DOCTOR"; label: string }
  | { kind: "cancel"; toStatus: "CANCELLED"; label: string };

export function isTerminalStatus(status: VisitStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The visit actions this screen offers for `role` on a visit in `status`.
 * Derived from QUEUE_TRANSITIONS (docs/api-inventory.md §3.2–3.3),
 * restricted to what the generic transition endpoint allows:
 *
 * - reception: REGISTERED → WAITING_FOR_NURSE, REGISTERED → WAITING_FOR_DOCTOR,
 *   and cancel from any non-terminal status.
 * - owner: cancel from any non-terminal status.
 * - every other role, and any terminal visit: nothing.
 *
 * Reception's WAITING_FOR_BILLING → COMPLETED is deliberately absent:
 * the generic endpoint refuses it (403), and completion belongs to billing.
 */
export function allowedVisitActions(role: string, status: VisitStatus): VisitAction[] {
  if (isTerminalStatus(status)) return [];

  const cancel: VisitAction = { kind: "cancel", toStatus: "CANCELLED", label: "Cancel visit" };

  if (role === ROLES.RECEPTION) {
    if (status === "REGISTERED") {
      return [
        { kind: "send", toStatus: "WAITING_FOR_NURSE", label: "Send to nurse" },
        { kind: "send", toStatus: "WAITING_FOR_DOCTOR", label: "Send to doctor (skip nursing)" },
        cancel,
      ];
    }
    return [cancel];
  }
  if (role === ROLES.OWNER) return [cancel];
  return [];
}

/** The patient's visit history as the patient page has it. */
export type VisitHistoryState = { status: "pending" } | { status: "error" } | { status: "success"; visits: Visit[] };

/**
 * What the "New visit" panel offers:
 * - inactive: no Create visit button — POST /visits refuses an inactive
 *   patient (PATIENT_INACTIVE, docs §5.4) — whatever the history says;
 * - checking: the history is still loading, so open visits aren't known yet;
 * - ready: Create visit, needing a second click when there are open visits
 *   or the history couldn't be loaded (so open visits weren't checked).
 */
export type CreateVisitPanelState =
  | { kind: "inactive" }
  | { kind: "checking" }
  | { kind: "ready"; openVisits: Visit[]; historyError: boolean; needsConfirmation: boolean };

export function createVisitPanelState(patientStatus: "active" | "inactive", history: VisitHistoryState): CreateVisitPanelState {
  if (patientStatus === "inactive") return { kind: "inactive" };
  if (history.status === "pending") return { kind: "checking" };
  const openVisits = history.status === "success" ? findOpenVisits(history.visits) : [];
  const historyError = history.status === "error";
  return { kind: "ready", openVisits, historyError, needsConfirmation: openVisits.length > 0 || historyError };
}

/** Visits in `visits` that are still in progress (not COMPLETED or CANCELLED). */
export function findOpenVisits(visits: readonly Visit[]): Visit[] {
  return visits.filter((visit) => !isTerminalStatus(visit.status));
}

export const CANCEL_REASON_MAX = 2000;

/**
 * Cancel reason as the backend requires it (trimmed, 1–2000 chars).
 * Returns the trimmed reason, or an error message.
 */
export function validateCancelReason(raw: string): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = raw.trim();
  if (reason.length === 0) return { ok: false, error: "Enter a reason for cancelling this visit." };
  if (reason.length > CANCEL_REASON_MAX) {
    return { ok: false, error: `Keep the reason under ${CANCEL_REASON_MAX} characters.` };
  }
  return { ok: true, reason };
}
