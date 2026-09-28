import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { doctorKeys } from "../doctor/queries";
import { inventoryKeys } from "../inventory/queries";
import { patientKeys } from "../patients/queries";
import { visitKeys } from "../visits/queries";
import { completePharmacy, dispenseItems, fetchPharmacyQueue, fetchPrescription, startPharmacy } from "./api";
import type { DispenseEntry } from "./dispenseForm";

export const pharmacyKeys = {
  queue: ["pharmacy", "queue"] as const,
  prescriptions: ["pharmacy", "prescription"] as const,
  prescription: (prescriptionId: string) => ["pharmacy", "prescription", prescriptionId] as const,
};

export const PHARMACY_QUEUE_REFRESH_MS = 15_000;

export function usePharmacyQueue() {
  return useQuery({
    queryKey: pharmacyKeys.queue,
    queryFn: ({ signal }) => fetchPharmacyQueue(signal),
    refetchInterval: PHARMACY_QUEUE_REFRESH_MS,
    staleTime: 0,
  });
}

export function usePrescription(prescriptionId: string) {
  return useQuery({
    queryKey: pharmacyKeys.prescription(prescriptionId),
    queryFn: ({ signal }) => fetchPrescription(prescriptionId, signal),
  });
}

/**
 * After any pharmacy action — success or failure: the queue, every
 * prescription, the visit's prescriptions, the visit, inventory (stock
 * moved), today's queue and patient histories refetch.
 */
function invalidateAfterPharmacyChange(queryClient: QueryClient, visitId: string) {
  void queryClient.invalidateQueries({ queryKey: pharmacyKeys.queue });
  void queryClient.invalidateQueries({ queryKey: pharmacyKeys.prescriptions });
  void queryClient.invalidateQueries({ queryKey: doctorKeys.visitPrescriptions(visitId) });
  void queryClient.invalidateQueries({ queryKey: visitKeys.detail(visitId) });
  void queryClient.invalidateQueries({ queryKey: inventoryKeys.items });
  void queryClient.invalidateQueries({ queryKey: visitKeys.today });
  void queryClient.invalidateQueries({ queryKey: [patientKeys.all[0], "visits"] });
}

export function useStartPharmacy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prescription: { id: string; visitId: string }) => startPharmacy(prescription.id),
    onSettled: (_data, _error, prescription) => invalidateAfterPharmacyChange(queryClient, prescription.visitId),
  });
}

export function usePrescriptionMutations(prescriptionId: string, visitId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => invalidateAfterPharmacyChange(queryClient, visitId);
  const dispense = useMutation({
    mutationFn: (entries: DispenseEntry[]) => dispenseItems(prescriptionId, entries),
    onSettled,
  });
  const complete = useMutation({ mutationFn: () => completePharmacy(prescriptionId), onSettled });
  return { dispense, complete };
}
