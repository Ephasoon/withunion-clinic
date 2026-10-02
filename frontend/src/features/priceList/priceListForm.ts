import { centsToAmount, parseMoneyToCents, toCents } from "../billing/money";
import type { CreatePriceListItemBody, PriceListItem, UpdatePriceListItemBody } from "./types";

/** Limits from CreatePriceListItemSchema / UpdatePriceListItemSchema (docs §5.17). The name is trimmed by the backend. */
export const PRICE_LIST_LIMITS = { name: 255, maxPriceCents: 10_000_000 * 100 } as const;

export interface PriceListValues {
  name: string;
  /** Raw text, e.g. "150" or "150.50". */
  price: string;
}

export type PriceListErrors = Partial<Record<keyof PriceListValues, string>>;

export const EMPTY_PRICE_LIST_ITEM: PriceListValues = { name: "", price: "" };

/** The form's starting values for an existing item. */
export function priceListValues(item: PriceListItem): PriceListValues {
  return { name: item.name, price: item.price.toFixed(2) };
}

/**
 * Field errors for the values as typed. The price must have at most 2
 * decimals — the backend rejects more rather than rounding. Duplicate
 * names are left to the backend (PRICE_LIST_ITEM_ALREADY_EXISTS).
 */
export function validatePriceListValues(values: PriceListValues): PriceListErrors {
  const errors: PriceListErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = "Enter the item’s name.";
  else if (name.length > PRICE_LIST_LIMITS.name) errors.name = `At most ${PRICE_LIST_LIMITS.name} characters.`;

  const cents = parseMoneyToCents(values.price);
  if (values.price.trim() === "") errors.price = "Enter the price (0 for no charge).";
  else if (cents === null) errors.price = "Enter an amount like 150 or 150.50.";
  else if (cents > PRICE_LIST_LIMITS.maxPriceCents) errors.price = "At most 10,000,000.";
  return errors;
}

/** POST /price-list body. */
export function buildCreatePriceListItem(
  values: PriceListValues
): { ok: true; body: CreatePriceListItemBody } | { ok: false; errors: PriceListErrors } {
  const errors = validatePriceListValues(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { name: values.name.trim(), price: centsToAmount(parseMoneyToCents(values.price)!) } };
}

export const NO_CHANGES_MESSAGE = "Change at least one field (name, price or active status) before saving.";

/**
 * PATCH /price-list/:id body with only what changed — the name compared
 * after trimming (the backend trims), the price compared in whole cents
 * (so "150" and "150.00" are the same). The backend requires at least one
 * field, via a refine with no path — its error carries no field details —
 * so "nothing changed" is caught here with a clear message.
 */
export function buildPriceListPatch(
  original: PriceListItem,
  draft: PriceListValues & { isActive: boolean }
): { ok: true; body: UpdatePriceListItemBody } | { ok: false; errors: PriceListErrors; message?: string } {
  const errors = validatePriceListValues(draft);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: UpdatePriceListItemBody = {};
  const name = draft.name.trim();
  if (name !== original.name) body.name = name;
  const cents = parseMoneyToCents(draft.price)!;
  if (cents !== toCents(original.price)) body.price = centsToAmount(cents);
  if (draft.isActive !== original.isActive) body.isActive = draft.isActive;
  if (Object.keys(body).length === 0) return { ok: false, errors: {}, message: NO_CHANGES_MESSAGE };
  return { ok: true, body };
}
