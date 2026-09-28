/** docs/api-inventory.md §3.1 and §4 (Visit, QueueEvent). */

export const VISIT_STATUSES = [
  "REGISTERED",
  "WAITING_FOR_NURSE",
  "WITH_NURSE",
  "WAITING_FOR_DOCTOR",
  "WITH_DOCTOR",
  "WAITING_FOR_LAB",
  "AT_LAB",
  "LAB_COMPLETED",
  "WAITING_FOR_PHARMACY",
  "AT_PHARMACY",
  "WAITING_FOR_BILLING",
  "COMPLETED",
  "CANCELLED",
] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const TERMINAL_STATUSES: readonly VisitStatus[] = ["COMPLETED", "CANCELLED"];

export interface Visit {
  id: string;
  patientId: string;
  patientCode: string;
  patientFullName: string;
  status: VisitStatus;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface QueueEvent {
  id: string;
  visitId: string;
  /** null only for the creation event. */
  fromStatus: VisitStatus | null;
  toStatus: VisitStatus;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

/**
 * The only destinations this frontend ever sends to
 * POST /visits/:id/transition: reception's two hand-offs from
 * REGISTERED, and cancel (reception or owner). Every other destination
 * is either another role's step or module-owned (403 on the generic
 * endpoint), so the type does not allow it.
 */
export type ReceptionTransitionTarget = "WAITING_FOR_NURSE" | "WAITING_FOR_DOCTOR" | "CANCELLED";
