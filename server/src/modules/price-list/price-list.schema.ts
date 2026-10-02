import { z } from "zod";

// Same 0–10000000 range as billing unitPrice / purchases unitCost, plus
// an explicit 2-decimal check — numeric(10,2) would otherwise silently
// round a value like 12.345 instead of rejecting it.
const price = z
  .number()
  .min(0, "price must not be negative")
  .max(10_000_000)
  .refine((value) => Math.round(value * 100) / 100 === value, { message: "price must have at most 2 decimal places" });

export const CreatePriceListItemSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    price,
  })
  .strict();

export type CreatePriceListItemInput = z.infer<typeof CreatePriceListItemSchema>;

/**
 * Every field optional (partial update), same shape/limits as
 * creation, plus isActive for deactivate/reactivate — no delete
 * endpoint exists, mirroring the Suppliers module's convention.
 */
export const UpdatePriceListItemSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    price: price.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

export type UpdatePriceListItemInput = z.infer<typeof UpdatePriceListItemSchema>;
