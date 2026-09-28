import type { PrescriptionDetail } from "../doctor/types";
import type { InventoryItem } from "../inventory/types";

/** Limits from DispenseRequestSchema (docs §5.8). */
export const DISPENSE_MAX_ENTRIES = 50;
export const DISPENSE_QUANTITY_MAX = 1_000_000;

export type PrescriptionItem = PrescriptionDetail["items"][number];

/** Exactly one of these per entry — the backend's strict union. */
export type DispenseEntry =
  | { itemId: string; inventoryItemId: string; quantity: number }
  | { itemId: string; markUnavailable: true };

/**
 * Units still to dispense, or null when no quantity was prescribed (then
 * a single dispense of any quantity completes the item, docs §5.8).
 */
export function remainingQuantity(item: Pick<PrescriptionItem, "quantityPrescribed" | "quantityDispensed">): number | null {
  if (item.quantityPrescribed === null) return null;
  return Math.max(0, item.quantityPrescribed - (item.quantityDispensed ?? 0));
}

/** A dispense is refused on DISPENSED and UNAVAILABLE items (ITEM_ALREADY_TERMINAL). */
export function canDispenseItem(item: Pick<PrescriptionItem, "status">): boolean {
  return item.status === "PENDING" || item.status === "PARTIALLY_DISPENSED";
}

/** Mark-unavailable is legal only from PENDING. */
export function canMarkUnavailable(item: Pick<PrescriptionItem, "status">): boolean {
  return item.status === "PENDING";
}

/**
 * The largest quantity worth offering for an item from a stock item:
 * never above what remains to dispense (EXCEEDS_PRESCRIBED_QUANTITY),
 * the stock on hand (INSUFFICIENT_STOCK), or the schema limit.
 */
export function maxDispensable(
  item: Pick<PrescriptionItem, "quantityPrescribed" | "quantityDispensed">,
  stock: Pick<InventoryItem, "quantityOnHand"> | undefined
): number {
  const remaining = remainingQuantity(item) ?? DISPENSE_QUANTITY_MAX;
  const onHand = stock?.quantityOnHand ?? 0;
  return Math.max(0, Math.min(remaining, onHand, DISPENSE_QUANTITY_MAX));
}

export type RowAction = "skip" | "dispense" | "unavailable";

export interface DispenseRow {
  action: RowAction;
  /** Chosen explicitly by the pharmacist — medicine names are free text and never matched to stock. */
  inventoryItemId: string;
  /** Raw text. */
  quantity: string;
}

export const SKIP_ROW: DispenseRow = { action: "skip", inventoryItemId: "", quantity: "" };

export type DispenseRowErrors = Partial<Record<"action" | "inventoryItemId" | "quantity", string>>;

/**
 * Validates the dispense form and builds the entries. Rows set to "skip"
 * are left out. Quantities are checked against what remains for the item
 * and against stock on hand — cumulatively when several rows draw on the
 * same stock item, because the backend decrements them one after another
 * inside the same transaction.
 */
export function validateDispenseForm(
  items: readonly PrescriptionItem[],
  rows: Record<string, DispenseRow>,
  inventory: readonly InventoryItem[]
):
  | { ok: true; entries: DispenseEntry[] }
  | { ok: false; rowErrors: Record<string, DispenseRowErrors>; error?: string } {
  const rowErrors: Record<string, DispenseRowErrors> = {};
  const entries: DispenseEntry[] = [];
  const stockById = new Map(inventory.map((s) => [s.id, s]));
  const drawnByStock = new Map<string, number>();

  for (const item of items) {
    const row = rows[item.id] ?? SKIP_ROW;
    const errors: DispenseRowErrors = {};

    if (row.action === "unavailable") {
      if (!canMarkUnavailable(item)) errors.action = "Only a medicine not yet dispensed can be marked unavailable.";
      else entries.push({ itemId: item.id, markUnavailable: true });
    } else if (row.action === "dispense") {
      if (!canDispenseItem(item)) {
        errors.action = "This medicine is already fully dispensed or unavailable.";
      } else {
        const stock = stockById.get(row.inventoryItemId);
        if (row.inventoryItemId === "") errors.inventoryItemId = "Choose the stock item to dispense from.";
        else if (!stock) errors.inventoryItemId = "That stock item no longer exists. Choose another.";

        const text = row.quantity.trim();
        const quantity = Number(text);
        const remaining = remainingQuantity(item);
        if (!/^\d+$/.test(text) || quantity < 1) {
          errors.quantity = "Enter a whole number of at least 1.";
        } else if (quantity > DISPENSE_QUANTITY_MAX) {
          errors.quantity = `At most ${DISPENSE_QUANTITY_MAX.toLocaleString("en")}.`;
        } else if (remaining !== null && quantity > remaining) {
          errors.quantity = `Only ${remaining} left to dispense.`;
        } else if (stock) {
          const drawn = (drawnByStock.get(stock.id) ?? 0) + quantity;
          drawnByStock.set(stock.id, drawn);
          if (drawn > stock.quantityOnHand) {
            errors.quantity = `Only ${stock.quantityOnHand} ${stock.unit} in stock${
              drawn > quantity ? " across this batch" : ""
            }.`;
          }
        }

        if (Object.keys(errors).length === 0 && stock) {
          entries.push({ itemId: item.id, inventoryItemId: stock.id, quantity });
        }
      }
    }
    if (Object.keys(errors).length > 0) rowErrors[item.id] = errors;
  }

  if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };
  if (entries.length === 0) return { ok: false, rowErrors, error: "Choose at least one medicine to dispense or mark unavailable." };
  if (entries.length > DISPENSE_MAX_ENTRIES) {
    return { ok: false, rowErrors, error: `At most ${DISPENSE_MAX_ENTRIES} medicines per batch.` };
  }
  return { ok: true, entries };
}
