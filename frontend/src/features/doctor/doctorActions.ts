import { ROLES } from "../../rbac/roles";
import type { Visit, VisitStatus } from "../visits/types";
import type { Consultation } from "./types";

/** The statuses that belong to the doctor, in the order the queue shows them. */
export const DOCTOR_QUEUE_STATUSES = ["WITH_DOCTOR", "LAB_COMPLETED", "WAITING_FOR_DOCTOR"] as const satisfies readonly VisitStatus[];

export interface DoctorVisitActions {
  /** POST /visits/:id/consultations from WAITING_FOR_DOCTOR (moves the visit to WITH_DOCTOR itself). */
  canStartConsultation: boolean;
  /** POST /visits/:id/transition { toStatus: "WITH_DOCTOR" } from LAB_COMPLETED — the only path (docs §3.3). */
  canTakeBackForReview: boolean;
  /** POST /visits/:id/consultations while WITH_DOCTOR with no consultation open (review after lab). */
  canOpenReviewConsultation: boolean;
}

const NONE: DoctorVisitActions = {
  canStartConsultation: false,
  canTakeBackForReview: false,
  canOpenReviewConsultation: false,
};

/**
 * What a user with `role` may do on the doctor's visit page. Only
 * doctors act; the owner and everyone else view only. A visit with an
 * open consultation offers no new one (the backend would refuse with
 * CONSULTATION_ALREADY_OPEN) — the open one is continued instead.
 * No status here ever leads to sending WAITING_FOR_LAB, WAITING_FOR_PHARMACY,
 * WAITING_FOR_BILLING or LAB_COMPLETED to the generic transition.
 */
export function allowedDoctorVisitActions(
  role: string,
  status: VisitStatus,
  hasOpenConsultation: boolean
): DoctorVisitActions {
  if (role !== ROLES.DOCTOR) return NONE;
  switch (status) {
    case "WAITING_FOR_DOCTOR":
      return { ...NONE, canStartConsultation: !hasOpenConsultation };
    case "LAB_COMPLETED":
      return { ...NONE, canTakeBackForReview: true };
    case "WITH_DOCTOR":
      return { ...NONE, canOpenReviewConsultation: !hasOpenConsultation };
    default:
      return NONE;
  }
}

/** The visit's open (not completed) consultation, if any. The backend allows at most one. */
export function findOpenConsultation<T extends Pick<Consultation, "completedAt">>(consultations: readonly T[]): T | null {
  return consultations.find((c) => c.completedAt === null) ?? null;
}

/**
 * Whether this user may change this consultation: only the doctor who
 * opened it, and only while it is open (requireOwnOpenConsultation,
 * docs §5.6). The backend enforces this; the UI only hides the controls.
 */
export function canEditConsultation(
  user: { id: string; role: string } | null,
  consultation: Pick<Consultation, "doctorId" | "completedAt">
): boolean {
  return (
    user !== null &&
    user.role === ROLES.DOCTOR &&
    consultation.doctorId === user.id &&
    consultation.completedAt === null
  );
}

/** Today's queue split by step, order kept (oldest first). The owner's list has every status, so it is filtered. */
export function splitDoctorQueue(visits: readonly Visit[]): {
  withDoctor: Visit[];
  labCompleted: Visit[];
  waiting: Visit[];
} {
  return {
    withDoctor: visits.filter((v) => v.status === "WITH_DOCTOR"),
    labCompleted: visits.filter((v) => v.status === "LAB_COMPLETED"),
    waiting: visits.filter((v) => v.status === "WAITING_FOR_DOCTOR"),
  };
}
