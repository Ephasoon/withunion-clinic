import type { PriceListItem } from "../priceList/types";
import type { ItemRow } from "./invoiceForms";
import { formatMoney } from "./money";

/**
 * The "From price list" picker on Add charges. GET /price-list returns
 * every item, inactive ones included (docs §5.17), so only active items
 * are offered — already in name order.
 */
export function activePriceListItems(items: readonly PriceListItem[]): PriceListItem[] {
  return items.filter((item) => item.isActive);
}

/** "Consultation — 250.00" */
export function priceListOptionLabel(item: PriceListItem): string {
  return `${item.name} — ${formatMoney(item.price)}`;
}

/**
 * Fills a charge row from a price-list item: description and unit price
 * (as 2-decimal text, e.g. "250.00", which validateInvoiceItems parses
 * exactly). Quantity is left as the user entered it. The result is an
 * ordinary row — it can still be edited and is validated like any other.
 */
export function fillRowFromPriceListItem(row: ItemRow, item: PriceListItem): ItemRow {
  return { ...row, description: item.name, unitPrice: item.price.toFixed(2) };
}
