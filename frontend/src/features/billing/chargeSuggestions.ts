import type { LabOrderDetail, PrescriptionDetail } from "../doctor/types";
import type { PriceListItem } from "../priceList/types";
import { toCents } from "./money";
import type { ChargeNameLink, InvoiceDetail, InvoiceItemBody } from "./types";

/**
 * Same normalization as the server's utils/chargeName.ts (the saved
 * links' nameKey): trimmed, every whitespace run — unicode spaces
 * included — collapsed to one space, lowercased. Must stay identical.
 */
export function normalizeChargeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * linked    — a saved link points at an active price-list item; ready to add.
 * confirm   — no usable link, but exactly one active price-list item has the
 *             same normalized name; reception confirms it (saving a link) first.
 * unmatched — nothing to go on; reception chooses a price (saving a link).
 */
export type SuggestionState = "linked" | "confirm" | "unmatched";

export interface ChargeSuggestion {
  /** kind + normalized name — unique per row. */
  key: string;
  kind: "medicine" | "lab";
  /** As first written on the visit (trimmed). */
  name: string;
  quantity: number;
  state: SuggestionState;
  /** Set for linked and confirm rows. */
  priceListItem?: PriceListItem;
  /** quantity × unit price in whole cents; null while unmatched. */
  lineTotalCents: number | null;
}

export interface SuggestionInput {
  prescriptions: readonly PrescriptionDetail[];
  labOrders: readonly LabOrderDetail[];
  /** GET /price-list — every item, inactive included. */
  priceList: readonly PriceListItem[];
  links: readonly ChargeNameLink[];
  invoiceItems: readonly Pick<InvoiceDetail["items"][number], "description" | "unitPrice">[];
}

/**
 * Charges suggested from what actually happened on the visit:
 * - medicines: DISPENSED / PARTIALLY_DISPENSED items only, at the quantity
 *   dispensed (not prescribed). PENDING and UNAVAILABLE suggest nothing;
 * - lab tests: every test of a COMPLETED lab order, quantity 1;
 * - consultation: never suggested (reception adds it by hand).
 * Lines with the same normalized name and kind (e.g. one medicine on two
 * prescriptions) become one row with the quantities summed, so it is
 * charged once. Matching to the price list is exact normalized-name
 * equality only (see SuggestionState). A row is dropped once the invoice
 * already has an item with the same description (normalized) and unit
 * price as its price-list item, so nothing is charged twice. Pure.
 */
export function buildChargeSuggestions(input: SuggestionInput): ChargeSuggestion[] {
  const lines: Array<{ kind: ChargeSuggestion["kind"]; name: string; quantity: number }> = [];
  for (const prescription of input.prescriptions) {
    for (const item of prescription.items) {
      if (item.status !== "DISPENSED" && item.status !== "PARTIALLY_DISPENSED") continue;
      const quantity = item.quantityDispensed ?? 0;
      if (quantity > 0) lines.push({ kind: "medicine", name: item.medicineName, quantity });
    }
  }
  for (const order of input.labOrders) {
    if (order.status !== "COMPLETED") continue;
    for (const item of order.items) lines.push({ kind: "lab", name: item.testName, quantity: 1 });
  }

  const merged = new Map<string, { kind: ChargeSuggestion["kind"]; name: string; nameKey: string; quantity: number }>();
  for (const line of lines) {
    const nameKey = normalizeChargeName(line.name);
    if (nameKey === "") continue;
    const key = `${line.kind}:${nameKey}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += line.quantity;
    else merged.set(key, { kind: line.kind, name: line.name.trim(), nameKey, quantity: line.quantity });
  }

  const priceListById = new Map(input.priceList.map((item) => [item.id, item]));
  const linkByName = new Map(input.links.map((link) => [link.nameKey, link]));
  const active = input.priceList.filter((item) => item.isActive);

  const suggestions: ChargeSuggestion[] = [];
  for (const [key, line] of merged) {
    const linked = priceListById.get(linkByName.get(line.nameKey)?.priceListItemId ?? "");
    let state: SuggestionState;
    let priceListItem: PriceListItem | undefined;
    if (linked?.isActive) {
      state = "linked";
      priceListItem = linked;
    } else {
      const sameName = active.filter((item) => normalizeChargeName(item.name) === line.nameKey);
      if (sameName.length === 1) {
        state = "confirm";
        priceListItem = sameName[0];
      } else {
        state = "unmatched";
      }
    }

    if (priceListItem && isAlreadyOnInvoice(priceListItem, input.invoiceItems)) continue;

    suggestions.push({
      key,
      kind: line.kind,
      name: line.name,
      quantity: line.quantity,
      state,
      priceListItem,
      lineTotalCents: priceListItem ? line.quantity * toCents(priceListItem.price) : null,
    });
  }
  return suggestions;
}

function isAlreadyOnInvoice(item: PriceListItem, invoiceItems: SuggestionInput["invoiceItems"]): boolean {
  const description = normalizeChargeName(item.name);
  const cents = toCents(item.price);
  return invoiceItems.some((i) => normalizeChargeName(i.description) === description && toCents(i.unitPrice) === cents);
}

/** The invoice line a suggestion adds: the price-list item's name and unit price, at the suggested quantity. */
export function suggestionToInvoiceItem(suggestion: ChargeSuggestion): InvoiceItemBody | null {
  if (!suggestion.priceListItem) return null;
  return {
    description: suggestion.priceListItem.name,
    quantity: suggestion.quantity,
    unitPrice: suggestion.priceListItem.price,
  };
}

/** "Add all" — only linked rows (a confirmed row is linked once its link is saved); never confirm or unmatched. */
export function addAllItems(suggestions: readonly ChargeSuggestion[]): InvoiceItemBody[] {
  return suggestions
    .filter((s) => s.state === "linked")
    .map(suggestionToInvoiceItem)
    .filter((item): item is InvoiceItemBody => item !== null);
}
