import { api } from "../../api";
import type { LabOrderDetail } from "../doctor/types";
import type { ResultEntry } from "./resultsForm";

const orderPath = (orderId: string) => `/api/v1/laboratory/orders/${encodeURIComponent(orderId)}`;

/**
 * GET /laboratory/orders → { orders } — lab_tech only. Only REQUESTED
 * orders whose visit is WAITING_FOR_LAB or AT_LAB, requestedAt ASC.
 */
export async function fetchLabQueue(signal?: AbortSignal): Promise<LabOrderDetail[]> {
  const { orders } = await api.get<{ orders: LabOrderDetail[] }>("/api/v1/laboratory/orders", { signal });
  return orders;
}

/** GET /laboratory/orders/:id → { order } — any role. */
export async function fetchLabOrder(orderId: string, signal?: AbortSignal): Promise<LabOrderDetail> {
  const { order } = await api.get<{ order: LabOrderDetail }>(orderPath(orderId), { signal });
  return order;
}

/**
 * POST /laboratory/orders/:id/start (no body) → { order }. Moves the
 * visit WAITING_FOR_LAB → AT_LAB. The lab screens never use the generic
 * transition endpoint.
 */
export async function startLabOrder(orderId: string): Promise<LabOrderDetail> {
  const { order } = await api.post<{ order: LabOrderDetail }>(`${orderPath(orderId)}/start`);
  return order;
}

/** POST /laboratory/orders/:id/results { results: [{ itemId, result }] } → { order }. Overwrites those items. */
export async function enterLabResults(orderId: string, results: ResultEntry[]): Promise<LabOrderDetail> {
  const { order } = await api.post<{ order: LabOrderDetail }>(`${orderPath(orderId)}/results`, { results });
  return order;
}

/**
 * POST /laboratory/orders/:id/complete (no body) → { order }. Completes
 * the visit's whole lab round (every REQUESTED order) and moves the visit
 * AT_LAB → LAB_COMPLETED in one transaction.
 */
export async function completeLabOrder(orderId: string): Promise<LabOrderDetail> {
  const { order } = await api.post<{ order: LabOrderDetail }>(`${orderPath(orderId)}/complete`);
  return order;
}
