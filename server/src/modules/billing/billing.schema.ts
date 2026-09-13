import { z } from "zod";

const InvoiceItemEntrySchema = z.object({
  description: z.string().trim().min(1, "description is required").max(255),
  quantity: z.number().int().positive("quantity must be a positive integer").max(100_000),
  unitPrice: z.number().min(0, "unitPrice must not be negative").max(10_000_000),
});

export const AddInvoiceItemsSchema = z
  .object({
    items: z.array(InvoiceItemEntrySchema).min(1, "at least one item is required").max(50),
  })
  .strict();

export type AddInvoiceItemsInput = z.infer<typeof AddInvoiceItemsSchema>;

const PAYMENT_METHODS = ["cash", "bank_transfer", "other"] as const;

export const RecordPaymentSchema = z
  .object({
    amount: z.number().positive("amount must be greater than zero").max(100_000_000),
    method: z.enum(PAYMENT_METHODS),
  })
  .strict();

export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;
