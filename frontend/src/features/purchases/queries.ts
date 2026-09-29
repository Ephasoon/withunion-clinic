import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryKeys } from "../inventory/queries";
import { createPurchase, fetchPurchase, fetchPurchases, receivePurchase } from "./api";
import type { CreatePurchaseBody } from "./types";

export const purchaseKeys = {
  list: ["purchases", "list"] as const,
  detail: (purchaseId: string) => ["purchases", "detail", purchaseId] as const,
};

export function usePurchases() {
  return useQuery({ queryKey: purchaseKeys.list, queryFn: ({ signal }) => fetchPurchases(signal) });
}

export function usePurchase(purchaseId: string) {
  return useQuery({ queryKey: purchaseKeys.detail(purchaseId), queryFn: ({ signal }) => fetchPurchase(purchaseId, signal) });
}

/**
 * After any purchase write — success or failure, since a 5xx may come
 * after the commit — refetch the purchases, the Purchasing report and
 * inventory (receiving changes stock; a rejected line means the stock
 * list was out of date), plus the dashboard's stock counts.
 */
function useInvalidatePurchases() {
  const queryClient = useQueryClient();
  return (purchaseId?: string) => {
    void queryClient.invalidateQueries({ queryKey: purchaseKeys.list });
    if (purchaseId) void queryClient.invalidateQueries({ queryKey: purchaseKeys.detail(purchaseId) });
    void queryClient.invalidateQueries({ queryKey: ["reports", "purchasing"] });
    void queryClient.invalidateQueries({ queryKey: inventoryKeys.items });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreatePurchase() {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: (body: CreatePurchaseBody) => createPurchase(body),
    onSettled: (purchase) => invalidate(purchase?.id),
  });
}

export function useReceivePurchase(purchaseId: string) {
  const invalidate = useInvalidatePurchases();
  return useMutation({
    mutationFn: () => receivePurchase(purchaseId),
    onSettled: () => invalidate(purchaseId),
  });
}
