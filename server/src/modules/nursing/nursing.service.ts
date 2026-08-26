import { pool } from "../../config/db";
import { AppError } from "../../utils/appError";
import { getVisitById, transitionVisit } from "../visits/visits.service";
import { RecordVitalsInput, RecordNursingAssessmentInput } from "./nursing.schema";

export interface VitalSigns {
  id: string;
  visitId: string;
  recordedBy: string;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  pulseBpm: number | null;
  temperatureCelsius: string | null;
  weightKg: string | null;
  heightCm: string | null;
  respiratoryRate: number | null;
  oxygenSaturationPct: number | null;
  notes: string | null;
  recordedAt: string;
}

export interface NursingAssessment {
  id: string;
  visitId: string;
  nurseId: string;
  chiefComplaint: string | null;
  assessmentNotes: string | null;
  createdAt: string;
}

interface VitalSignsRow {
  id: string;
  visit_id: string;
  recorded_by: string;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  pulse_bpm: number | null;
  temperature_celsius: string | null;
  weight_kg: string | null;
  height_cm: string | null;
  respiratory_rate: number | null;
  oxygen_saturation_pct: number | null;
  notes: string | null;
  recorded_at: string;
}

interface NursingAssessmentRow {
  id: string;
  visit_id: string;
  nurse_id: string;
  chief_complaint: string | null;
  assessment_notes: string | null;
  created_at: string;
}

function toVitalSigns(row: VitalSignsRow): VitalSigns {
  return {
    id: row.id,
    visitId: row.visit_id,
    recordedBy: row.recorded_by,
    bloodPressureSystolic: row.blood_pressure_systolic,
    bloodPressureDiastolic: row.blood_pressure_diastolic,
    pulseBpm: row.pulse_bpm,
    temperatureCelsius: row.temperature_celsius,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    respiratoryRate: row.respiratory_rate,
    oxygenSaturationPct: row.oxygen_saturation_pct,
    notes: row.notes,
    recordedAt: row.recorded_at,
  };
}

function toNursingAssessment(row: NursingAssessmentRow): NursingAssessment {
  return {
    id: row.id,
    visitId: row.visit_id,
    nurseId: row.nurse_id,
    chiefComplaint: row.chief_complaint,
    assessmentNotes: row.assessment_notes,
    createdAt: row.created_at,
  };
}

/**
 * Both nursing actions share this precondition: the visit must
 * currently be WITH_NURSE. This is deliberately checked here in the
 * nursing module (an ordinary business-rule read), not by adding new
 * state-machine logic — the existing transitionVisit()/canTransition()
 * in the Visits module remains the only place status legality is
 * decided or written.
 */
async function requireVisitWithNurse(visitId: string) {
  const visit = await getVisitById(visitId);
  if (!visit) {
    throw new AppError(404, "NOT_FOUND", "Visit not found");
  }
  if (visit.status !== "WITH_NURSE") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Nursing actions require the visit to be WITH_NURSE (currently ${visit.status})`
    );
  }
  return visit;
}

/**
 * Vitals are intentionally repeatable (Phase 1 §9 / blueprint §2.4) —
 * a nurse may retake a reading within the same visit, so this simply
 * inserts a new row each call rather than upserting.
 */
export async function recordVitals(
  visitId: string,
  recordedBy: string,
  input: RecordVitalsInput
): Promise<VitalSigns> {
  await requireVisitWithNurse(visitId);

  const result = await pool.query<VitalSignsRow>(
    `INSERT INTO vital_signs
       (visit_id, recorded_by, blood_pressure_systolic, blood_pressure_diastolic, pulse_bpm,
        temperature_celsius, weight_kg, height_cm, respiratory_rate, oxygen_saturation_pct, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      visitId,
      recordedBy,
      input.bloodPressureSystolic ?? null,
      input.bloodPressureDiastolic ?? null,
      input.pulseBpm ?? null,
      input.temperatureCelsius ?? null,
      input.weightKg ?? null,
      input.heightCm ?? null,
      input.respiratoryRate ?? null,
      input.oxygenSaturationPct ?? null,
      input.notes ?? null,
    ]
  );
  return toVitalSigns(result.rows[0]);
}

export async function listVitalsForVisit(visitId: string): Promise<VitalSigns[]> {
  const result = await pool.query<VitalSignsRow>(
    `SELECT * FROM vital_signs WHERE visit_id = $1 ORDER BY recorded_at ASC`,
    [visitId]
  );
  return result.rows.map(toVitalSigns);
}

export async function getNursingAssessment(visitId: string): Promise<NursingAssessment | null> {
  const result = await pool.query<NursingAssessmentRow>(
    `SELECT * FROM nursing_assessments WHERE visit_id = $1`,
    [visitId]
  );
  return result.rows[0] ? toNursingAssessment(result.rows[0]) : null;
}

/**
 * Records (or revises, before hand-off) the single nursing assessment
 * for a visit, then fires the existing WITH_NURSE -> WAITING_FOR_DOCTOR
 * transition through transitionVisit() — the same function, same
 * role check, same queue_events ledger entry, same audit convention
 * that every other stage change in the app already goes through.
 * Nursing never writes to visits.status directly.
 */
export async function recordNursingAssessmentAndAdvance(
  visitId: string,
  nurseId: string,
  input: RecordNursingAssessmentInput
): Promise<{ assessment: NursingAssessment; visitStatus: string }> {
  await requireVisitWithNurse(visitId);

  const result = await pool.query<NursingAssessmentRow>(
    `INSERT INTO nursing_assessments (visit_id, nurse_id, chief_complaint, assessment_notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (visit_id) DO UPDATE
       SET chief_complaint = EXCLUDED.chief_complaint,
           assessment_notes = EXCLUDED.assessment_notes,
           nurse_id = EXCLUDED.nurse_id
     RETURNING *`,
    [visitId, nurseId, input.chiefComplaint ?? null, input.assessmentNotes ?? null]
  );
  const assessment = toNursingAssessment(result.rows[0]);

  const visit = await transitionVisit(visitId, "nurse", "WAITING_FOR_DOCTOR", undefined, nurseId);

  return { assessment, visitStatus: visit.status };
}
