import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isApiError } from "../../api";
import { patientKeys } from "../patients/queries";
import { createVisit, fetchTodayVisits, fetchVisit, transitionVisit } from "./api";

export const visitKeys = {
  all: ["visits"] as const,
  today: ["visits", "today"] as const,
  detail: (visitId: string) => ["visits", "detail", visitId] as const,
};

/** How often the queue refreshes while the page is open. */
export const TODAY_QUEUE_REFRESH_MS = 15_000;

export function useTodayVisits() {
  return useQuery({
    queryKey: visitKeys.today,
    queryFn: ({ signal }) => fetchTodayVisits(signal),
    refetchInterval: TODAY_QUEUE_REFRESH_MS,
    staleTime: 0,
  });
}

export function useVisit(visitId: string, enabled = true) {
  return useQuery({
    queryKey: visitKeys.detail(visitId),
    queryFn: ({ signal }) => fetchVisit(visitId, signal),
    enabled,
  });
}

/** After any visit change: the queue, that visit, and the patient's history all refetch. */
function invalidateAfterVisitChange(queryClient: QueryClient, visitId: string | undefined, patientId: string) {
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  if (visitId) void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: patientKeys.visits(patientId) });
}

export function useCreateVisit(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createVisit(patientId),
    onSettled: (visit, error) => {
      invalidateAfterVisitChange(queryClient, visit?.id, patientId);
      // Made inactive elsewhere since this page loaded: refetch so the page shows it.
      if (isApiError(error) && error.code === "PATIENT_INACTIVE") {
        void queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      }
    },
  });
}

/**
 * Invalidates on success and on failure: a VISIT_TERMINAL or FORBIDDEN
 * usually means the visit moved on elsewhere, so the page should show
 * its real status.
 */
export function useTransitionVisit(visitId: string, patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof transitionVisit>[1]) => transitionVisit(visitId, input),
    onSettled: () => invalidateAfterVisitChange(queryClient, visitId, patientId),
  });
}
