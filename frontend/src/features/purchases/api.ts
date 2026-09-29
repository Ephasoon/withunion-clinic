import { api } from "../../api";
import type { CreatePurchaseBody, PurchaseDetail } from "./types";

const purchasePath = (purchaseId: string) => `/api/v1/purchases/${encodeURIComponent(purchaseId)}`;

/** GET /purchases → { purchases } — owner only; createdAt DESC, with items, no pagination. */
export async function fetchPurchases(signal?: AbortSignal): Promise<PurchaseDetail[]> {
  const { purchases } = await api.get<{ purchases: PurchaseDetail[] }>("/api/v1/purchases", { signal });
  return purchases;
}

/** GET /purchases/:id → { purchase }. */
export async function fetchPurchase(purchaseId: string, signal?: AbortSignal): Promise<PurchaseDetail> {
  const { purchase } = await api.get<{ purchase: PurchaseDetail }>(purchasePath(purchaseId), { signal });
  return purchase;
}

/**
 * POST /purchases → 201 { purchase } (PENDING; stock untouched). One
 * unknown inventoryItemId rolls back the whole purchase (INVALID_INVENTORY_ITEM).
 */
export async function createPurchase(body: CreatePurchaseBody): Promise<PurchaseDetail> {
  const { purchase } = await api.post<{ purchase: PurchaseDetail }>("/api/v1/purchases", body);
  return purchase;
}

/** POST /purchases/:id/receive, no body → { purchase }. Adds every line to stock in one transaction; no partial receiving. */
export async function receivePurchase(purchaseId: string): Promise<PurchaseDetail> {
  const { purchase } = await api.post<{ purchase: PurchaseDetail }>(`${purchasePath(purchaseId)}/receive`);
  return purchase;
}
