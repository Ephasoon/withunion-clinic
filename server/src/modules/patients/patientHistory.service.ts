import { listVisitsForPatient, Visit } from "../visits/visits.service";
import { Consultation, Diagnosis, listConsultationsForVisit } from "../consultation/consultation.service";
import { LabOrderDetail, listLabOrdersForVisit } from "../laboratory/laboratory.service";
import { listPrescriptionsForVisit, PharmacyPrescriptionDetail } from "../pharmacy/pharmacy.service";
import { listVitalsForVisit, VitalSigns } from "../nursing/nursing.service";

export type PatientHistoryVisit = Visit & {
  consultations: Array<Consultation & { diagnoses: Diagnosis[] }>;
  prescriptions: PharmacyPrescriptionDetail[];
  labOrders: LabOrderDetail[];
  vitals: VitalSigns[];
};

/**
 * A patient's other visits with their full clinical record — no new
 * queries: each visit is filled in by the same per-visit functions
 * that back GET /visits/:id/consultations, /prescriptions, /lab-orders
 * and /vitals, so the history always matches what those routes show.
 *
 * Every visit except excludeVisitId (the one being worked on), any
 * status, newest first — the same order as GET /patients/:id/visits.
 * An excludeVisitId that isn't one of this patient's visits excludes
 * nothing. Prescriptions are returned unredacted; the route applies
 * the per-role redaction, as the Pharmacy routes do.
 */
export async function getPatientHistory(patientId: string, excludeVisitId?: string): Promise<PatientHistoryVisit[]> {
  const visits = (await listVisitsForPatient(patientId)).filter((visit) => visit.id !== excludeVisitId);
  return Promise.all(
    visits.map(async (visit) => {
      const [consultations, prescriptions, labOrders, vitals] = await Promise.all([
        listConsultationsForVisit(visit.id),
        listPrescriptionsForVisit(visit.id),
        listLabOrdersForVisit(visit.id),
        listVitalsForVisit(visit.id),
      ]);
      return { ...visit, consultations, prescriptions, labOrders, vitals };
    })
  );
}
