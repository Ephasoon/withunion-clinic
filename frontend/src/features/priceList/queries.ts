import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPriceListItem, fetchPriceList, fetchPriceListItem, updatePriceListItem } from "./api";
import type { CreatePriceListItemBody, UpdatePriceListItemBody } from "./types";

export const priceListKeys = {
  list: ["price-list", "list"] as const,
  detail: (itemId: string) => ["price-list", "detail", itemId] as const,
};

export function usePriceList(enabled = true) {
  return useQuery({ queryKey: priceListKeys.list, queryFn: ({ signal }) => fetchPriceList(signal), enabled });
}

export function usePriceListItem(itemId: string) {
  return useQuery({ queryKey: priceListKeys.detail(itemId), queryFn: ({ signal }) => fetchPriceListItem(itemId, signal) });
}

/**
 * After any price-list write — success or failure — the list is
 * refetched. Billing's "Add charges" picker reads the same list, so it
 * picks up new prices and deactivations too.
 */
function useInvalidatePriceList() {
  const queryClient = useQueryClient();
  return (itemId?: string) => {
    void queryClient.invalidateQueries({ queryKey: priceListKeys.list });
    if (itemId) void queryClient.invalidateQueries({ queryKey: priceListKeys.detail(itemId) });
  };
}

export function useCreatePriceListItem() {
  const invalidate = useInvalidatePriceList();
  return useMutation({
    mutationFn: (body: CreatePriceListItemBody) => createPriceListItem(body),
    onSettled: (item) => invalidate(item?.id),
  });
}

export function useUpdatePriceListItem(itemId: string) {
  const invalidate = useInvalidatePriceList();
  return useMutation({
    mutationFn: (body: UpdatePriceListItemBody) => updatePriceListItem(itemId, body),
    onSettled: () => invalidate(itemId),
  });
}
