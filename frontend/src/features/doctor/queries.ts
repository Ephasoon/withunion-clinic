import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { patientKeys } from "../patients/queries";
import { visitKeys } from "../visits/queries";
import {
  addDiagnosis,
  completeConsultation,
  createLabOrder,
  createPrescription,
  fetchConsultation,
  fetchPatientHistory,
  fetchVisitConsultations,
  fetchVisitLabOrders,
  fetchVisitPrescriptions,
  openConsultation,
  takeBackForReview,
  updateNotes,
} from "./api";
import type { PrescriptionItemBody } from "./types";

export const doctorKeys = {
  consultation: (consultationId: string) => ["doctor", "consultation", consultationId] as const,
  /** Prefix for every visit-scoped doctor list below. */
  visit: (visitId: string) => ["doctor", "visit", visitId] as const,
  visitConsultations: (visitId: string) => ["doctor", "visit", visitId, "consultations"] as const,
  visitLabOrders: (visitId: string) => ["doctor", "visit", visitId, "lab-orders"] as const,
  visitPrescriptions: (visitId: string) => ["doctor", "visit", visitId, "prescriptions"] as const,
  patientHistory: (patientId: string, excludeVisitId: string) =>
    ["doctor", "patient-history", patientId, { excludeVisitId }] as const,
};

/** Visit-scoped reads. Enable only once GET /visits/:id has succeeded (load the visit first). */
export function useVisitConsultations(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: doctorKeys.visitConsultations(visitId),
    queryFn: ({ signal }) => fetchVisitConsultations(visitId, signal),
    enabled,
  });
}

export function useVisitLabOrders(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: doctorKeys.visitLabOrders(visitId),
    queryFn: ({ signal }) => fetchVisitLabOrders(visitId, signal),
    enabled,
  });
}

export function useVisitPrescriptions(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: doctorKeys.visitPrescriptions(visitId),
    queryFn: ({ signal }) => fetchVisitPrescriptions(visitId, signal),
    enabled,
  });
}

/**
 * The patient's other visits with their full records (GET /patients/:id/history).
 * Past visits don't change while this consultation is worked on, so no
 * doctor action invalidates it; it refetches on the usual focus/stale rules.
 */
export function usePatientHistory(patientId: string, excludeVisitId: string, enabled: boolean) {
  return useQuery({
    queryKey: doctorKeys.patientHistory(patientId, excludeVisitId),
    queryFn: ({ signal }) => fetchPatientHistory(patientId, excludeVisitId, signal),
    enabled,
  });
}

export function useConsultation(consultationId: string) {
  return useQuery({
    queryKey: doctorKeys.consultation(consultationId),
    queryFn: ({ signal }) => fetchConsultation(consultationId, signal),
  });
}

/**
 * After any doctor action: the queue, the visit, every visit-scoped
 * doctor list, the consultation (if any), and patient histories refetch.
 */
function invalidateAfterDoctorChange(queryClient: QueryClient, visitId: string, consultationId?: string) {
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: doctorKeys.visit(visitId) });
  if (consultationId) void queryClient.invalidateQueries({ queryKey: doctorKeys.consultation(consultationId) });
  void queryClient.invalidateQueries({ queryKey: [patientKeys.all[0], "visits"] });
}

export function useOpenConsultation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) => openConsultation(visitId),
    onSettled: (_data, _error, visitId) => invalidateAfterDoctorChange(queryClient, visitId),
  });
}

export function useTakeBackForReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) => takeBackForReview(visitId),
    onSettled: (_data, _error, visitId) => invalidateAfterDoctorChange(queryClient, visitId),
  });
}

/** Mutations on one open consultation. All invalidate on failure too, so the page shows the real state. */
export function useConsultationMutations(consultationId: string, visitId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => invalidateAfterDoctorChange(queryClient, visitId, consultationId);

  const saveNotes = useMutation({ mutationFn: (notes: string) => updateNotes(consultationId, notes), onSettled });
  const diagnosis = useMutation({
    mutationFn: (description: string) => addDiagnosis(consultationId, description),
    onSettled,
  });
  const labOrder = useMutation({
    mutationFn: (testNames: string[]) => createLabOrder(consultationId, testNames),
    onSettled,
  });
  const prescription = useMutation({
    mutationFn: (items: PrescriptionItemBody[]) => createPrescription(consultationId, items),
    onSettled,
  });
  const complete = useMutation({ mutationFn: () => completeConsultation(consultationId), onSettled });

  return { saveNotes, diagnosis, labOrder, prescription, complete };
}
