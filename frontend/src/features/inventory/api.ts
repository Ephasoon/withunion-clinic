import { api } from "../../api";
import type { CreateInventoryItemBody, InventoryItem } from "./types";

/** GET /inventory/items → { items } — owner and pharmacy; every item, name ASC, no pagination. */
export async function fetchInventory(signal?: AbortSignal): Promise<InventoryItem[]> {
  const { items } = await api.get<{ items: InventoryItem[] }>("/api/v1/inventory/items", { signal });
  return items;
}

/**
 * POST /inventory/items { name, unit, quantityOnHand } → 201 { item } — owner only.
 * There is no update, adjust or delete endpoint: stock changes only by
 * dispensing and by receiving purchases.
 */
export async function createInventoryItem(body: CreateInventoryItemBody): Promise<InventoryItem> {
  const { item } = await api.post<{ item: InventoryItem }>("/api/v1/inventory/items", body);
  return item;
}
