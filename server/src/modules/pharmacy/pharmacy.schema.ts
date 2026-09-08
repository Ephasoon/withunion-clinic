import { z } from "zod";

const QuantityDispenseEntry = z.object({
  itemId: z.string().uuid("itemId must be a valid uuid"),
  inventoryItemId: z.string().uuid("inventoryItemId must be a valid uuid"),
  quantity: z.number().int().positive("quantity must be a positive integer").max(1_000_000),
});

const MarkUnavailableEntry = z.object({
  itemId: z.string().uuid("itemId must be a valid uuid"),
  markUnavailable: z.literal(true),
});

/**
 * A dispense entry is exactly one of: a quantity dispense against a
 * specific inventory item, or a mark-unavailable — never both, never
 * neither. Modeled as a discriminated union on shape (via .strict()
 * on each branch) so an entry carrying both quantity/inventoryItemId
 * AND markUnavailable, or neither, is rejected by Zod itself rather
 * than left for the service layer to sort out.
 */
const DispenseEntrySchema = z.union([
  QuantityDispenseEntry.strict(),
  MarkUnavailableEntry.strict(),
]);

export const DispenseRequestSchema = z
  .object({
    items: z.array(DispenseEntrySchema).min(1, "at least one item is required").max(50),
  })
  .strict();

export type DispenseRequestInput = z.infer<typeof DispenseRequestSchema>;
export type DispenseEntry = z.infer<typeof DispenseEntrySchema>;