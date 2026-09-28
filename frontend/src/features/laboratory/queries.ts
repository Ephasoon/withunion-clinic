import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { doctorKeys } from "../doctor/queries";
import { patientKeys } from "../patients/queries";
import { visitKeys } from "../visits/queries";
import { completeLabOrder, enterLabResults, fetchLabOrder, fetchLabQueue, startLabOrder } from "./api";
import type { ResultEntry } from "./resultsForm";

export const labKeys = {
  queue: ["laboratory", "queue"] as const,
  order: (orderId: string) => ["laboratory", "order", orderId] as const,
};

export const LAB_QUEUE_REFRESH_MS = 15_000;

export function useLabQueue() {
  return useQuery({
    queryKey: labKeys.queue,
    queryFn: ({ signal }) => fetchLabQueue(signal),
    refetchInterval: LAB_QUEUE_REFRESH_MS,
    staleTime: 0,
  });
}

export function useLabOrder(orderId: string) {
  return useQuery({
    queryKey: labKeys.order(orderId),
    queryFn: ({ signal }) => fetchLabOrder(orderId, signal),
  });
}

/**
 * After any lab action — success or failure (another technician may have
 * completed the round, or the visit may have moved on): the lab queue,
 * the order, every order on the visit, the visit, today's queue and
 * patient histories refetch.
 */
function invalidateAfterLabChange(queryClient: QueryClient, orderId: string, visitId: string) {
  void queryClient.invalidateQueries({ queryKey: labKeys.queue });
  void queryClient.invalidateQueries({ queryKey: ["laboratory", "order"] });
  void queryClient.invalidateQueries({ queryKey: labKeys.order(orderId) });
  void queryClient.invalidateQueries({ queryKey: doctorKeys.visitLabOrders(visitId) });
  void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  void queryClient.invalidateQueries({ queryKey: [patientKeys.all[0], "visits"] });
}

export function useStartLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order: { id: string; visitId: string }) => startLabOrder(order.id),
    onSettled: (_data, _error, order) => invalidateAfterLabChange(queryClient, order.id, order.visitId),
  });
}

export function useLabOrderMutations(orderId: string, visitId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => invalidateAfterLabChange(queryClient, orderId, visitId);
  const saveResults = useMutation({
    mutationFn: (results: ResultEntry[]) => enterLabResults(orderId, results),
    onSettled,
  });
  const complete = useMutation({ mutationFn: () => completeLabOrder(orderId), onSettled });
  return { saveResults, complete };
}
