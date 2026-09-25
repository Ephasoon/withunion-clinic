import { z } from "zod";

const PurchaseItemSchema = z.object({
  inventoryItemId: z.string().uuid("inventoryItemId must be a valid uuid"),
  quantity: z.number().int().positive("quantity must be a positive integer").max(1_000_000),
  unitCost: z.number().min(0, "unitCost must not be negative").max(10_000_000),
});

export const CreatePurchaseSchema = z
  .object({
    supplierId: z.string().uuid("supplierId must be a valid uuid"),
    purchaseDate: z.string().date("purchaseDate must be an ISO date (YYYY-MM-DD)"),
    referenceNumber: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(PurchaseItemSchema).min(1, "at least one item is required").max(50),
  })
  .strict();

export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>;
