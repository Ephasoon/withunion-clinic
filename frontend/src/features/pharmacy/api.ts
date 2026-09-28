import { api } from "../../api";
import type { PrescriptionDetail } from "../doctor/types";
import type { DispenseEntry } from "./dispenseForm";

const prescriptionPath = (prescriptionId: string) =>
  `/api/v1/pharmacy/prescriptions/${encodeURIComponent(prescriptionId)}`;

/**
 * GET /pharmacy/prescriptions → { prescriptions } — pharmacy only. Every
 * prescription of each visit that is WAITING_FOR_PHARMACY or AT_PHARMACY,
 * createdAt ASC.
 */
export async function fetchPharmacyQueue(signal?: AbortSignal): Promise<PrescriptionDetail[]> {
  const { prescriptions } = await api.get<{ prescriptions: PrescriptionDetail[] }>("/api/v1/pharmacy/prescriptions", {
    signal,
  });
  return prescriptions;
}

/** GET /pharmacy/prescriptions/:id → { prescription } — inventoryItemId is real for pharmacy and owner. */
export async function fetchPrescription(prescriptionId: string, signal?: AbortSignal): Promise<PrescriptionDetail> {
  const { prescription } = await api.get<{ prescription: PrescriptionDetail }>(prescriptionPath(prescriptionId), {
    signal,
  });
  return prescription;
}

/**
 * POST /pharmacy/prescriptions/:id/start (no body) → { prescription }.
 * Moves the visit WAITING_FOR_PHARMACY → AT_PHARMACY. The pharmacy screens
 * never use the generic transition endpoint.
 */
export async function startPharmacy(prescriptionId: string): Promise<PrescriptionDetail> {
  const { prescription } = await api.post<{ prescription: PrescriptionDetail }>(`${prescriptionPath(prescriptionId)}/start`);
  return prescription;
}

/**
 * POST /pharmacy/prescriptions/:id/dispense { items } → { prescription }.
 * The whole batch is one transaction: any failing entry rolls back all of it.
 */
export async function dispenseItems(prescriptionId: string, items: DispenseEntry[]): Promise<PrescriptionDetail> {
  const { prescription } = await api.post<{ prescription: PrescriptionDetail }>(
    `${prescriptionPath(prescriptionId)}/dispense`,
    { items }
  );
  return prescription;
}

/**
 * POST /pharmacy/prescriptions/:id/complete (no body) → { prescription, visitStatus }.
 * Requires no PENDING item on any prescription of the visit, then moves the
 * visit AT_PHARMACY → WAITING_FOR_BILLING in the same transaction.
 */
export async function completePharmacy(
  prescriptionId: string
): Promise<{ prescription: PrescriptionDetail; visitStatus: "WAITING_FOR_BILLING" }> {
  return api.post<{ prescription: PrescriptionDetail; visitStatus: "WAITING_FOR_BILLING" }>(
    `${prescriptionPath(prescriptionId)}/complete`
  );
}
