import { isValidIsoDate } from "../../lib/dates";
import { centsToAmount, formatMoney, parseMoneyToCents } from "../billing/money";
import type { CreatePurchaseBody, PurchaseItem } from "./types";

/** Limits from CreatePurchaseSchema (docs §5.15). */
export const PURCHASE_LIMITS = {
  minItems: 1,
  maxItems: 50,
  maxQuantity: 1_000_000,
  /** unitCost 0–10,000,000, stored as numeric(10,2) — so at most 2 decimals. */
  maxUnitCostCents: 10_000_000 * 100,
  referenceNumber: 100,
  notes: 2000,
} as const;

export interface PurchaseItemRow {
  /** Client-side row key only; never sent. */
  key: string;
  inventoryItemId: string;
  quantity: string;
  unitCost: string;
}

export interface PurchaseFormValues {
  supplierId: string;
  /** "YYYY-MM-DD", kept as a string end to end. */
  purchaseDate: string;
  referenceNumber: string;
  notes: string;
  items: PurchaseItemRow[];
}

export type RowErrors = Partial<Record<"inventoryItemId" | "quantity" | "unitCost", string>>;

export interface PurchaseFormErrors {
  supplierId?: string;
  purchaseDate?: string;
  referenceNumber?: string;
  notes?: string;
  /** About the item list as a whole (none, or too many). */
  items?: string;
  /** Per-row errors, keyed by row key. */
  rows: Record<string, RowErrors>;
}

/** A row with nothing entered is ignored rather than rejected. */
export function isBlankRow(row: PurchaseItemRow): boolean {
  return row.inventoryItemId === "" && row.quantity.trim() === "" && row.unitCost.trim() === "";
}

/** Whole number 1–1,000,000, typed as plain digits. */
export function parseQuantity(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= PURCHASE_LIMITS.maxQuantity ? n : null;
}

/** 0–10,000,000 with at most 2 decimals, as whole cents; null when not valid. */
export function parseUnitCostCents(text: string): number | null {
  const cents = parseMoneyToCents(text);
  return cents !== null && cents <= PURCHASE_LIMITS.maxUnitCostCents ? cents : null;
}

function validateRow(row: PurchaseItemRow): RowErrors {
  const errors: RowErrors = {};
  if (row.inventoryItemId === "") errors.inventoryItemId = "Choose a stock item.";
  if (row.quantity.trim() === "") errors.quantity = "Enter a quantity.";
  else if (parseQuantity(row.quantity) === null) {
    errors.quantity = `A whole number from 1 to ${PURCHASE_LIMITS.maxQuantity.toLocaleString("en-US")}.`;
  }
  if (row.unitCost.trim() === "") errors.unitCost = "Enter the unit cost (0 if free).";
  else if (parseUnitCostCents(row.unitCost) === null) {
    errors.unitCost = "An amount from 0 to 10,000,000 with at most 2 decimals.";
  }
  return errors;
}

/**
 * Checks the whole form and builds the POST /purchases body. Blank rows
 * are dropped; 1–50 filled rows are required. purchaseDate is sent
 * exactly as typed ("YYYY-MM-DD") — it is never converted through Date.
 * Amounts are parsed from the text into cents, then sent as numbers.
 */
export function buildCreatePurchase(
  values: PurchaseFormValues
): { ok: true; body: CreatePurchaseBody } | { ok: false; errors: PurchaseFormErrors } {
  const errors: PurchaseFormErrors = { rows: {} };
  if (values.supplierId === "") errors.supplierId = "Choose a supplier.";
  if (values.purchaseDate === "") errors.purchaseDate = "Enter the purchase date.";
  else if (!isValidIsoDate(values.purchaseDate)) errors.purchaseDate = "Enter a valid date.";
  const referenceNumber = values.referenceNumber.trim();
  if (referenceNumber.length > PURCHASE_LIMITS.referenceNumber) {
    errors.referenceNumber = `At most ${PURCHASE_LIMITS.referenceNumber} characters.`;
  }
  const notes = values.notes.trim();
  if (notes.length > PURCHASE_LIMITS.notes) errors.notes = `At most ${PURCHASE_LIMITS.notes} characters.`;

  const filled = values.items.filter((row) => !isBlankRow(row));
  if (filled.length < PURCHASE_LIMITS.minItems) errors.items = "Add at least one item.";
  else if (filled.length > PURCHASE_LIMITS.maxItems) {
    errors.items = `A purchase can have at most ${PURCHASE_LIMITS.maxItems} items. Split it into more than one purchase.`;
  }
  for (const row of filled) {
    const rowErrors = validateRow(row);
    if (Object.keys(rowErrors).length > 0) errors.rows[row.key] = rowErrors;
  }

  const hasErrors = Object.keys(errors).some((k) => k !== "rows") || Object.keys(errors.rows).length > 0;
  if (hasErrors) return { ok: false, errors };

  const body: CreatePurchaseBody = {
    supplierId: values.supplierId,
    purchaseDate: values.purchaseDate,
    items: filled.map((row) => ({
      inventoryItemId: row.inventoryItemId,
      quantity: parseQuantity(row.quantity)!,
      unitCost: centsToAmount(parseUnitCostCents(row.unitCost)!),
    })),
  };
  if (referenceNumber !== "") body.referenceNumber = referenceNumber;
  if (notes !== "") body.notes = notes;
  return { ok: true, body };
}

/** The total of the filled, valid rows in cents — for the live total under the form. */
export function draftTotalCents(rows: readonly PurchaseItemRow[]): number {
  let total = 0;
  for (const row of rows) {
    const quantity = parseQuantity(row.quantity);
    const cents = parseUnitCostCents(row.unitCost);
    if (quantity !== null && cents !== null) total += quantity * cents;
  }
  return total;
}

/** A saved purchase's total, summed in cents from the API's 2 dp amounts. */
export function purchaseTotal(items: readonly Pick<PurchaseItem, "quantity" | "unitCost">[]): number {
  return centsToAmount(items.reduce((sum, i) => sum + i.quantity * Math.round(i.unitCost * 100), 0));
}

export function formatCents(cents: number): string {
  return formatMoney(centsToAmount(cents));
}
