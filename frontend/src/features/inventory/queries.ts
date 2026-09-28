import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createInventoryItem, fetchInventory } from "./api";
import type { CreateInventoryItemBody } from "./types";

export const inventoryKeys = {
  items: ["inventory", "items"] as const,
};

export function useInventory(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.items,
    queryFn: ({ signal }) => fetchInventory(signal),
    enabled,
  });
}

export function useCreateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInventoryItemBody) => createInventoryItem(body),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: inventoryKeys.items }),
  });
}
