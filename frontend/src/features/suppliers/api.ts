import { api } from "../../api";
import type { CreateSupplierBody, Supplier, UpdateSupplierBody } from "./types";

const supplierPath = (supplierId: string) => `/api/v1/suppliers/${encodeURIComponent(supplierId)}`;

/** GET /suppliers → { suppliers } — owner only; every supplier incl. inactive, name ASC, no pagination. */
export async function fetchSuppliers(signal?: AbortSignal): Promise<Supplier[]> {
  const { suppliers } = await api.get<{ suppliers: Supplier[] }>("/api/v1/suppliers", { signal });
  return suppliers;
}

/** GET /suppliers/:id → { supplier }. */
export async function fetchSupplier(supplierId: string, signal?: AbortSignal): Promise<Supplier> {
  const { supplier } = await api.get<{ supplier: Supplier }>(supplierPath(supplierId), { signal });
  return supplier;
}

/** POST /suppliers → 201 { supplier } (created active). Names need not be unique. */
export async function createSupplier(body: CreateSupplierBody): Promise<Supplier> {
  const { supplier } = await api.post<{ supplier: Supplier }>("/api/v1/suppliers", body);
  return supplier;
}

/** PATCH /suppliers/:id with only the changed fields → { supplier }. Also deactivates/reactivates (no delete endpoint). */
export async function updateSupplier(supplierId: string, body: UpdateSupplierBody): Promise<Supplier> {
  const { supplier } = await api.patch<{ supplier: Supplier }>(supplierPath(supplierId), body);
  return supplier;
}
