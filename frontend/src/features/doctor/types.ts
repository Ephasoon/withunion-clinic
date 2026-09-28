import type { VisitStatus } from "../visits/types";

/** docs/api-inventory.md §4 and §5.6–5.8. */

export interface Consultation {
  id: string;
  visitId: string;
  doctorId: string;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface Diagnosis {
  id: string;
  consultationId: string;
  description: string;
  createdAt: string;
}

/** GET /visits/:id/consultations items. */
export type ConsultationWithDiagnoses = Consultation & { diagnoses: Diagnosis[] };

/** POST /consultations/:id/lab-orders → { labOrder }. */
export interface LabOrderCreated {
  id: string;
  visitId: string;
  consultationId: string;
  requestedBy: string;
  status: "REQUESTED";
  requestedAt: string;
  testNames: string[];
}

/** GET /visits/:id/lab-orders items (read-only here). */
export interface LabOrderDetail {
  id: string;
  visitId: string;
  consultationId: string;
  requestedBy: string;
  requestedByName: string;
  status: "REQUESTED" | "COMPLETED";
  requestedAt: string;
  visitStatus: VisitStatus;
  patientCode: string;
  patientFullName: string;
  items: Array<{
    id: string;
    testName: string;
    result: string | null;
    resultEnteredBy: string | null;
    resultEnteredAt: string | null;
  }>;
}

export type PrescriptionItemStatus = "PENDING" | "PARTIALLY_DISPENSED" | "DISPENSED" | "UNAVAILABLE";

/** GET /visits/:id/prescriptions items (read-only here; inventoryItemId is redacted to null for doctors). */
export interface PrescriptionDetail {
  id: string;
  visitId: string;
  consultationId: string;
  doctorId: string;
  doctorName: string;
  visitStatus: VisitStatus;
  patientCode: string;
  patientFullName: string;
  createdAt: string;
  items: Array<{
    id: string;
    medicineName: string;
    strength: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    quantityPrescribed: number | null;
    quantityDispensed: number | null;
    status: PrescriptionItemStatus;
    inventoryItemId: string | null;
    dispensedBy: string | null;
    dispensedAt: string | null;
  }>;
}

/** One item of POST /consultations/:id/prescriptions. */
export interface PrescriptionItemBody {
  medicineName: string;
  strength?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  quantityPrescribed?: number;
}

/** The only statuses POST /consultations/:id/complete moves a visit to (docs §5.6). */
export type CompletionStatus = "WAITING_FOR_LAB" | "WAITING_FOR_PHARMACY" | "WAITING_FOR_BILLING";
