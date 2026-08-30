import { z } from "zod";

export const UpdateConsultationNotesSchema = z
  .object({
    notes: z.string().trim().max(8000),
  })
  .strict();

export type UpdateConsultationNotesInput = z.infer<typeof UpdateConsultationNotesSchema>;

export const CreateDiagnosisSchema = z
  .object({
    description: z.string().trim().min(1, "description is required").max(2000),
  })
  .strict();

export type CreateDiagnosisInput = z.infer<typeof CreateDiagnosisSchema>;

export const CreateLabOrderSchema = z
  .object({
    testNames: z.array(z.string().trim().min(1).max(255)).min(1, "at least one test is required").max(50),
  })
  .strict();

export type CreateLabOrderInput = z.infer<typeof CreateLabOrderSchema>;

/**
 * medicineName is free text in this phase — see the migration
 * comment for why (no medicines/inventory table exists yet, and
 * prescribing must not be blocked on Phase 5 inventory work).
 */
const PrescriptionItemSchema = z.object({
  medicineName: z.string().trim().min(1, "medicineName is required").max(255),
  strength: z.string().trim().max(100).optional(),
  dosage: z.string().trim().max(100).optional(),
  frequency: z.string().trim().max(100).optional(),
  duration: z.string().trim().max(100).optional(),
  quantityPrescribed: z.number().int().positive().max(100000).optional(),
});

export const CreatePrescriptionSchema = z
  .object({
    items: z.array(PrescriptionItemSchema).min(1, "at least one medicine is required").max(50),
  })
  .strict();

export type CreatePrescriptionInput = z.infer<typeof CreatePrescriptionSchema>;
