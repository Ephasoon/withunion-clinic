import { z } from "zod";

/**
 * All vitals individually optional — a nurse may not capture every
 * field every visit (Phase 1 §9). Ranges are loose sanity bounds
 * (catch typos like "3700" for temperature), not clinical limits.
 */
export const RecordVitalsSchema = z
  .object({
    bloodPressureSystolic: z.number().int().min(30).max(300).optional(),
    bloodPressureDiastolic: z.number().int().min(20).max(200).optional(),
    pulseBpm: z.number().int().min(20).max(300).optional(),
    temperatureCelsius: z.number().min(25).max(45).optional(),
    weightKg: z.number().min(0.5).max(400).optional(),
    heightCm: z.number().min(20).max(250).optional(),
    respiratoryRate: z.number().int().min(4).max(80).optional(),
    oxygenSaturationPct: z.number().int().min(30).max(100).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export type RecordVitalsInput = z.infer<typeof RecordVitalsSchema>;

export const RecordNursingAssessmentSchema = z
  .object({
    chiefComplaint: z.string().trim().max(2000).optional(),
    assessmentNotes: z.string().trim().max(4000).optional(),
  })
  .strict();

export type RecordNursingAssessmentInput = z.infer<typeof RecordNursingAssessmentSchema>;
