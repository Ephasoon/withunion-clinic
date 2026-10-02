import { api } from "../../api";
import type { CreatePriceListItemBody, PriceListItem, UpdatePriceListItemBody } from "./types";

const itemPath = (itemId: string) => `/api/v1/price-list/${encodeURIComponent(itemId)}`;

/** GET /price-list → { items } — owner and reception; every item incl. inactive, name ASC, no pagination. */
export async function fetchPriceList(signal?: AbortSignal): Promise<PriceListItem[]> {
  const { items } = await api.get<{ items: PriceListItem[] }>("/api/v1/price-list", { signal });
  return items;
}

/** GET /price-list/:id → { item } — owner only. */
export async function fetchPriceListItem(itemId: string, signal?: AbortSignal): Promise<PriceListItem> {
  const { item } = await api.get<{ item: PriceListItem }>(itemPath(itemId), { signal });
  return item;
}

/** POST /price-list → 201 { item } (created active). Names are unique, ignoring case and spacing. */
export async function createPriceListItem(body: CreatePriceListItemBody): Promise<PriceListItem> {
  const { item } = await api.post<{ item: PriceListItem }>("/api/v1/price-list", body);
  return item;
}

/** PATCH /price-list/:id with only the changed fields → { item }. Also deactivates/reactivates (no delete endpoint). */
export async function updatePriceListItem(itemId: string, body: UpdatePriceListItemBody): Promise<PriceListItem> {
  const { item } = await api.patch<{ item: PriceListItem }>(itemPath(itemId), body);
  return item;
}
