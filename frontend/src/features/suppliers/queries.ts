import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupplier, fetchSupplier, fetchSuppliers, updateSupplier } from "./api";
import type { CreateSupplierBody, UpdateSupplierBody } from "./types";

export const supplierKeys = {
  list: ["suppliers", "list"] as const,
  detail: (supplierId: string) => ["suppliers", "detail", supplierId] as const,
};

export function useSuppliers(enabled = true) {
  return useQuery({ queryKey: supplierKeys.list, queryFn: ({ signal }) => fetchSuppliers(signal), enabled });
}

export function useSupplier(supplierId: string) {
  return useQuery({ queryKey: supplierKeys.detail(supplierId), queryFn: ({ signal }) => fetchSupplier(supplierId, signal) });
}

/**
 * After any supplier write — success or failure — the lists are
 * refetched. Purchases and the Purchasing report show the supplier’s name, so
 * they are refreshed too.
 */
function useInvalidateSuppliers() {
  const queryClient = useQueryClient();
  return (supplierId?: string) => {
    void queryClient.invalidateQueries({ queryKey: supplierKeys.list });
    if (supplierId) void queryClient.invalidateQueries({ queryKey: supplierKeys.detail(supplierId) });
    void queryClient.invalidateQueries({ queryKey: ["purchases"] });
    void queryClient.invalidateQueries({ queryKey: ["reports", "purchasing"] });
  };
}

export function useCreateSupplier() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (body: CreateSupplierBody) => createSupplier(body),
    onSettled: (supplier) => invalidate(supplier?.id),
  });
}

export function useUpdateSupplier(supplierId: string) {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: (body: UpdateSupplierBody) => updateSupplier(supplierId, body),
    onSettled: () => invalidate(supplierId),
  });
}
