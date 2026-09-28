import { isApiError } from "../../api";
import { describeApiError } from "../../lib/errorMessages";
import type { CreateInventoryItemBody } from "./types";

/** Limits from CreateInventoryItemSchema (docs §5.9), after trimming. */
export const ITEM_NAME_MAX = 255;
export const ITEM_UNIT_MAX = 50;
export const QUANTITY_ON_HAND_MAX = 10_000_000;

export interface InventoryFormValues {
  name: string;
  unit: string;
  /** Raw text. */
  quantityOnHand: string;
}

export type InventoryFormErrors = Partial<Record<keyof InventoryFormValues, string>>;

export const EMPTY_INVENTORY_FORM: InventoryFormValues = { name: "", unit: "", quantityOnHand: "" };

/** Validates the new-stock-item form and builds the POST /inventory/items body. */
export function validateInventoryForm(
  values: InventoryFormValues
): { ok: true; body: CreateInventoryItemBody } | { ok: false; errors: InventoryFormErrors } {
  const errors: InventoryFormErrors = {};
  const name = values.name.trim();
  const unit = values.unit.trim();
  const quantityText = values.quantityOnHand.trim();

  if (name === "") errors.name = "Enter the item name.";
  else if (name.length > ITEM_NAME_MAX) errors.name = `Keep the name under ${ITEM_NAME_MAX} characters.`;

  if (unit === "") errors.unit = "Enter the unit, e.g. tablet or bottle.";
  else if (unit.length > ITEM_UNIT_MAX) errors.unit = `Keep the unit under ${ITEM_UNIT_MAX} characters.`;

  let quantityOnHand = 0;
  if (quantityText === "") errors.quantityOnHand = "Enter the quantity on hand (0 if none).";
  else if (!/^\d+$/.test(quantityText) || Number(quantityText) > QUANTITY_ON_HAND_MAX) {
    errors.quantityOnHand = `Whole number, 0–${QUANTITY_ON_HAND_MAX.toLocaleString("en")}.`;
  } else quantityOnHand = Number(quantityText);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { name, unit, quantityOnHand } };
}

/** User-facing text for a failed POST /inventory/items. */
export function inventoryErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === "INVENTORY_ITEM_ALREADY_EXISTS") {
    return "A stock item with this name already exists (names are matched ignoring case and spacing).";
  }
  return describeApiError(error);
}
