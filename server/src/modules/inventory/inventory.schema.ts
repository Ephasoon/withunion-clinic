import { z } from "zod";

export const CreateInventoryItemSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    unit: z.string().trim().min(1, "unit is required").max(50),
    quantityOnHand: z.number().int().min(0, "quantityOnHand must not be negative").max(10_000_000),
  })
  .strict();

export type CreateInventoryItemInput = z.infer<typeof CreateInventoryItemSchema>;