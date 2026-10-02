import { api } from "../../api";
import { toVitalSigns } from "../nursing/vitals";
import type { Visit } from "../visits/types";
import type {
  CompletionStatus,
  Consultation,
  ConsultationWithDiagnoses,
  Diagnosis,
  LabOrderCreated,
  LabOrderDetail,
  PatientHistoryVisit,
  PatientHistoryVisitResponse,
  PrescriptionDetail,
  PrescriptionItemBody,
} from "./types";

const visitPath = (visitId: string) => `/api/v1/visits/${encodeURIComponent(visitId)}`;
const consultationPath = (consultationId: string) => `/api/v1/consultations/${encodeURIComponent(consultationId)}`;

/**
 * GET /patients/:id/history?excludeVisitId= → { visits } — every other
 * visit of the patient (any status, newest first), each with its
 * consultations + diagnoses, prescriptions, lab orders + results and
 * vitals. Vitals are converted like GET /visits/:id/vitals.
 */
export async function fetchPatientHistory(
  patientId: string,
  excludeVisitId: string,
  signal?: AbortSignal
): Promise<PatientHistoryVisit[]> {
  const { visits } = await api.get<{ visits: PatientHistoryVisitResponse[] }>(
    `/api/v1/patients/${encodeURIComponent(patientId)}/history`,
    { query: { excludeVisitId }, signal }
  );
  return visits.map((visit) => ({ ...visit, vitals: visit.vitals.map(toVitalSigns) }));
}

/**
 * POST /visits/:id/consultations (no body) → 201 { consultation }.
 * From WAITING_FOR_DOCTOR it moves the visit to WITH_DOCTOR itself;
 * from WITH_DOCTOR (review after lab) there is no transition.
 */
export async function openConsultation(visitId: string): Promise<Consultation> {
  const { consultation } = await api.post<{ consultation: Consultation }>(`${visitPath(visitId)}/consultations`);
  return consultation;
}

/**
 * POST /visits/:id/transition { toStatus: "WITH_DOCTOR" } — LAB_COMPLETED → WITH_DOCTOR,
 * the only path back for review (docs §3.3). The only transition the doctor screens
 * send to the generic endpoint; every other move goes through POST /consultations/:id/complete.
 */
export async function takeBackForReview(visitId: string): Promise<Visit> {
  const { visit } = await api.post<{ visit: Visit }>(`${visitPath(visitId)}/transition`, { toStatus: "WITH_DOCTOR" });
  return visit;
}

/** GET /visits/:id/consultations → { consultations } (startedAt ASC, each with diagnoses). */
export async function fetchVisitConsultations(visitId: string, signal?: AbortSignal): Promise<ConsultationWithDiagnoses[]> {
  const { consultations } = await api.get<{ consultations: ConsultationWithDiagnoses[] }>(
    `${visitPath(visitId)}/consultations`,
    { signal }
  );
  return consultations;
}

/** GET /visits/:id/lab-orders → { orders } (all statuses, requestedAt ASC). */
export async function fetchVisitLabOrders(visitId: string, signal?: AbortSignal): Promise<LabOrderDetail[]> {
  const { orders } = await api.get<{ orders: LabOrderDetail[] }>(`${visitPath(visitId)}/lab-orders`, { signal });
  return orders;
}

/** GET /visits/:id/prescriptions → { prescriptions } (createdAt ASC). */
export async function fetchVisitPrescriptions(visitId: string, signal?: AbortSignal): Promise<PrescriptionDetail[]> {
  const { prescriptions } = await api.get<{ prescriptions: PrescriptionDetail[] }>(
    `${visitPath(visitId)}/prescriptions`,
    { signal }
  );
  return prescriptions;
}

/** GET /consultations/:id → { consultation, diagnoses } (no lab orders or prescriptions). */
export async function fetchConsultation(
  consultationId: string,
  signal?: AbortSignal
): Promise<{ consultation: Consultation; diagnoses: Diagnosis[] }> {
  return api.get<{ consultation: Consultation; diagnoses: Diagnosis[] }>(consultationPath(consultationId), { signal });
}

/** PATCH /consultations/:id { notes } → { consultation }. Replaces the notes. */
export async function updateNotes(consultationId: string, notes: string): Promise<Consultation> {
  const { consultation } = await api.patch<{ consultation: Consultation }>(consultationPath(consultationId), { notes });
  return consultation;
}

/** POST /consultations/:id/diagnoses { description } → 201 { diagnosis }. */
export async function addDiagnosis(consultationId: string, description: string): Promise<Diagnosis> {
  const { diagnosis } = await api.post<{ diagnosis: Diagnosis }>(`${consultationPath(consultationId)}/diagnoses`, {
    description,
  });
  return diagnosis;
}

/** POST /consultations/:id/lab-orders { testNames } → 201 { labOrder } (the key is labOrder). */
export async function createLabOrder(consultationId: string, testNames: string[]): Promise<LabOrderCreated> {
  const { labOrder } = await api.post<{ labOrder: LabOrderCreated }>(`${consultationPath(consultationId)}/lab-orders`, {
    testNames,
  });
  return labOrder;
}

/** POST /consultations/:id/prescriptions { items } → 201 { prescription }. */
export async function createPrescription(consultationId: string, items: PrescriptionItemBody[]): Promise<{ id: string }> {
  const { prescription } = await api.post<{ prescription: { id: string } }>(
    `${consultationPath(consultationId)}/prescriptions`,
    { items }
  );
  return prescription;
}

/** POST /consultations/:id/complete (no body) → { consultation, visitStatus }. */
export async function completeConsultation(
  consultationId: string
): Promise<{ consultation: Consultation; visitStatus: CompletionStatus }> {
  return api.post<{ consultation: Consultation; visitStatus: CompletionStatus }>(
    `${consultationPath(consultationId)}/complete`
  );
}
