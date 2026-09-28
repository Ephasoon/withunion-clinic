import { centsToAmount, parseMoneyToCents, toCents } from "./money";
import { PAYMENT_METHODS, type InvoiceItemBody, type PaymentBody, type PaymentMethod } from "./types";

/** Limits from billing.schema.ts (docs §5.10) and the numeric(10,2) column (docs §7.5). */
export const DESCRIPTION_MAX = 255;
export const ITEM_QUANTITY_MAX = 100_000;
export const UNIT_PRICE_MAX_CENTS = 10_000_000 * 100;
export const INVOICE_ITEMS_MAX = 50;
/** The schema allows 100,000,000, but the column holds at most 99,999,999.99 (docs §7.5). */
export const PAYMENT_MAX_CENTS = 9_999_999_999;

export interface ItemRow {
  description: string;
  /** Raw text. */
  quantity: string;
  /** Raw text, e.g. "150" or "150.50". */
  unitPrice: string;
}

export const EMPTY_ITEM_ROW: ItemRow = { description: "", quantity: "1", unitPrice: "" };

export type ItemRowErrors = Partial<Record<keyof ItemRow, string>>;

function isBlankRow(row: ItemRow): boolean {
  return row.description.trim() === "" && row.unitPrice.trim() === "" && ["", "1"].includes(row.quantity.trim());
}

/** A row's line total in cents, or null while it isn't valid yet (for a live preview). */
export function lineTotalCents(row: ItemRow): number | null {
  const quantity = row.quantity.trim();
  const price = parseMoneyToCents(row.unitPrice);
  if (!/^\d+$/.test(quantity) || price === null) return null;
  return Number(quantity) * price;
}

/**
 * POST /billing/invoices/:id/items { items } — 1–50 items; description
 * trimmed 1–255, quantity a whole number 1–100000, unit price 0–10,000,000
 * with at most 2 decimals (so nothing is silently rounded). Untouched rows
 * are ignored.
 */
export function validateInvoiceItems(
  rows: readonly ItemRow[]
): { ok: true; items: InvoiceItemBody[] } | { ok: false; rowErrors: ItemRowErrors[]; error?: string } {
  const rowErrors: ItemRowErrors[] = rows.map(() => ({}));
  const items: InvoiceItemBody[] = [];

  rows.forEach((row, index) => {
    if (isBlankRow(row)) return;
    const errors = rowErrors[index]!;

    const description = row.description.trim();
    if (description === "") errors.description = "Describe the charge.";
    else if (description.length > DESCRIPTION_MAX) errors.description = `Keep under ${DESCRIPTION_MAX} characters.`;

    const quantityText = row.quantity.trim();
    const quantity = Number(quantityText);
    if (!/^\d+$/.test(quantityText) || quantity < 1 || quantity > ITEM_QUANTITY_MAX) {
      errors.quantity = `Whole number, 1–${ITEM_QUANTITY_MAX.toLocaleString("en")}.`;
    }

    const priceCents = parseMoneyToCents(row.unitPrice);
    if (row.unitPrice.trim() === "") errors.unitPrice = "Enter the unit price (0 for no charge).";
    else if (priceCents === null) errors.unitPrice = "Enter an amount like 150 or 150.50.";
    else if (priceCents > UNIT_PRICE_MAX_CENTS) errors.unitPrice = "At most 10,000,000.";

    if (Object.keys(errors).length === 0) {
      items.push({ description, quantity, unitPrice: centsToAmount(priceCents!) });
    }
  });

  if (rowErrors.some((e) => Object.keys(e).length > 0)) return { ok: false, rowErrors };
  if (items.length === 0) return { ok: false, rowErrors, error: "Add at least one charge." };
  if (items.length > INVOICE_ITEMS_MAX) {
    return { ok: false, rowErrors, error: `Add at most ${INVOICE_ITEMS_MAX} charges at a time.` };
  }
  return { ok: true, items };
}

export type PaymentErrors = Partial<Record<"amount" | "method", string>>;

/**
 * POST /billing/invoices/:id/payments { amount, method } — amount above 0,
 * at most 2 decimals, and never above the current balance (the backend's
 * OVERPAYMENT, checked here first because it is an obvious mistake).
 * Compared in whole cents, so an exact final payment is always accepted.
 */
export function validatePayment(
  amountText: string,
  method: PaymentMethod | "",
  balance: number
): { ok: true; body: PaymentBody } | { ok: false; errors: PaymentErrors } {
  const errors: PaymentErrors = {};
  const cents = parseMoneyToCents(amountText);
  const balanceCents = toCents(balance);

  if (amountText.trim() === "") errors.amount = "Enter the amount received.";
  else if (cents === null) errors.amount = "Enter an amount like 150 or 150.50.";
  else if (cents === 0) errors.amount = "The amount must be more than 0.";
  else if (cents > balanceCents) errors.amount = "That is more than the remaining balance.";
  else if (cents > PAYMENT_MAX_CENTS) errors.amount = "That amount is too large.";

  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) errors.method = "Choose how the patient paid.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { amount: centsToAmount(cents!), method: method as PaymentMethod } };
}
