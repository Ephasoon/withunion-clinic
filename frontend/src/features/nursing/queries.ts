import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { patientKeys } from "../patients/queries";
import { visitKeys } from "../visits/queries";
import { fetchAssessment, fetchVitals, recordAssessment, recordVitals, startNursing } from "./api";
import type { RecordAssessmentBody, RecordVitalsBody } from "./types";

export const nursingKeys = {
  vitals: (visitId: string) => ["nursing", "vitals", visitId] as const,
  assessment: (visitId: string) => ["nursing", "assessment", visitId] as const,
};

/**
 * Vitals for a visit. Pass `enabled` only once the visit itself has
 * loaded: this endpoint returns [] for a visit that does not exist.
 */
export function useVitals(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: nursingKeys.vitals(visitId),
    queryFn: ({ signal }) => fetchVitals(visitId, signal),
    enabled,
  });
}

export function useAssessment(visitId: string, enabled: boolean) {
  return useQuery({
    queryKey: nursingKeys.assessment(visitId),
    queryFn: ({ signal }) => fetchAssessment(visitId, signal),
    enabled,
  });
}

/** After any nursing change: the queue, the visit, and the patient's visit history refetch. */
function invalidateVisit(queryClient: QueryClient, visitId: string, patientId: string) {
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: patientKeys.visits(patientId) });
}

/**
 * WAITING_FOR_NURSE → WITH_NURSE. Invalidates on failure too: another
 * nurse may have picked the patient up first.
 */
export function useStartNursing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (visit: { id: string; patientId: string }) => startNursing(visit.id),
    onSettled: (_data, _error, visit) => invalidateVisit(queryClient, visit.id, visit.patientId),
  });
}

export function useRecordVitals(visitId: string, patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordVitalsBody) => recordVitals(visitId, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: nursingKeys.vitals(visitId) });
      invalidateVisit(queryClient, visitId, patientId);
    },
  });
}

/**
 * Records the assessment (which also sends the visit to the doctor).
 * Invalidates the assessment and the visit on failure too: the backend
 * may have saved the assessment and then failed to move the visit, and
 * the page must show what actually happened.
 */
export function useRecordAssessment(visitId: string, patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordAssessmentBody) => recordAssessment(visitId, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: nursingKeys.assessment(visitId) });
      invalidateVisit(queryClient, visitId, patientId);
    },
  });
}
