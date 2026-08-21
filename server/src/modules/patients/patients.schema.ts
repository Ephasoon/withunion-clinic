import { z } from "zod";

const GenderEnum = z.enum(["male", "female", "other"]);

/**
 * Patient must have either a date_of_birth OR an approximate_age
 * (not necessarily both) — enforced with a refine rather than making
 * both required, since Phase 1 §5 allows either.
 */
export const CreatePatientSchema = z
  .object({
    fullName: z.string().trim().min(1, "fullName is required").max(255),
    gender: GenderEnum,
    dateOfBirth: z.string().date().optional(), // ISO date string, e.g. "1990-05-14"
    approximateAge: z.number().int().min(0).max(150).optional(),
    phone: z.string().trim().max(32).optional(),
    address: z.string().trim().max(2000).optional(),
    emergencyContactName: z.string().trim().max(255).optional(),
    emergencyContactPhone: z.string().trim().max(32).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((data) => data.dateOfBirth || data.approximateAge !== undefined, {
    message: "Either dateOfBirth or approximateAge is required",
    path: ["dateOfBirth"],
  });

export type CreatePatientInput = z.infer<typeof CreatePatientSchema>;

/**
 * Every field optional (partial update) but the same shape/limits
 * as creation. Registration-defining fields like patient_code are
 * never editable through this schema.
 */
export const UpdatePatientSchema = z
  .object({
    fullName: z.string().trim().min(1).max(255).optional(),
    gender: GenderEnum.optional(),
    dateOfBirth: z.string().date().optional(),
    approximateAge: z.number().int().min(0).max(150).optional(),
    phone: z.string().trim().max(32).optional(),
    address: z.string().trim().max(2000).optional(),
    emergencyContactName: z.string().trim().max(255).optional(),
    emergencyContactPhone: z.string().trim().max(32).optional(),
    notes: z.string().trim().max(2000).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();

export type UpdatePatientInput = z.infer<typeof UpdatePatientSchema>;

export const SearchPatientsQuerySchema = z.object({
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SearchPatientsQuery = z.infer<typeof SearchPatientsQuerySchema>;
