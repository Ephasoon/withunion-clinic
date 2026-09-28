import { ROLES } from "../../rbac/roles";
import type { PrescriptionDetail } from "../doctor/types";
import type { VisitStatus } from "../visits/types";

export interface PharmacyActions {
  /** POST /pharmacy/prescriptions/:id/start — visit WAITING_FOR_PHARMACY → AT_PHARMACY (never the generic transition). */
  canStart: boolean;
  /** POST /pharmacy/prescriptions/:id/dispense — only while the visit is AT_PHARMACY. */
  canDispense: boolean;
  /** POST /pharmacy/prescriptions/:id/complete — only while the visit is AT_PHARMACY. */
  canComplete: boolean;
}

const NONE: PharmacyActions = { canStart: false, canDispense: false, canComplete: false };

/**
 * What a user with `role` may do on a prescription, from the visit's
 * status (the backend's preconditions, docs §5.8). Only the pharmacy
 * role acts; the owner and everyone else view only.
 */
export function allowedPharmacyActions(role: string, visitStatus: VisitStatus): PharmacyActions {
  if (role !== ROLES.PHARMACY) return NONE;
  if (visitStatus === "WAITING_FOR_PHARMACY") return { ...NONE, canStart: true };
  if (visitStatus === "AT_PHARMACY") return { canStart: false, canDispense: true, canComplete: true };
  return NONE;
}

export interface PharmacyQueueGroup {
  visitId: string;
  patientCode: string;
  patientFullName: string;
  visitStatus: VisitStatus;
  prescriptions: PrescriptionDetail[];
}

/**
 * GET /pharmacy/prescriptions grouped by visit: a visit can have several
 * prescriptions, and starting or completing works on the whole visit.
 * Groups and prescriptions keep the API's order (createdAt ASC).
 */
export function groupPrescriptionsByVisit(prescriptions: readonly PrescriptionDetail[]): PharmacyQueueGroup[] {
  const groups = new Map<string, PharmacyQueueGroup>();
  for (const p of prescriptions) {
    let group = groups.get(p.visitId);
    if (!group) {
      group = {
        visitId: p.visitId,
        patientCode: p.patientCode,
        patientFullName: p.patientFullName,
        visitStatus: p.visitStatus,
        prescriptions: [],
      };
      groups.set(p.visitId, group);
    }
    group.prescriptions.push(p);
  }
  return [...groups.values()];
}
