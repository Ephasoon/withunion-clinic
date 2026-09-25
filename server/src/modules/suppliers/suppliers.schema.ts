import { z } from "zod";

export const CreateSupplierSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    contactPerson: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email("must be a valid email").max(255).optional(),
    address: z.string().trim().max(2000).optional(),
  })
  .strict();

export type CreateSupplierInput = z.infer<typeof CreateSupplierSchema>;

/**
 * Every field optional (partial update), same shape/limits as
 * creation, plus isActive for deactivate/reactivate — no delete
 * endpoint exists, mirroring the Users module's convention.
 */
export const UpdateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    contactPerson: z.string().trim().max(255).optional(),
    phone: z.string().trim().max(32).optional(),
    email: z.string().trim().email("must be a valid email").max(255).optional(),
    address: z.string().trim().max(2000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field is required" });

export type UpdateSupplierInput = z.infer<typeof UpdateSupplierSchema>;
