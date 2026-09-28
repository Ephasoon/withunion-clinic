/** docs/api-inventory.md §4 VitalSigns / NursingAssessment and §5.5. */

/** A vitals row exactly as the API returns it. NUMERIC columns arrive as strings ("37.5") or null. */
export interface VitalSignsResponse {
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

/** A vitals row with every measurement as a number (see toVitalSigns). */
export interface VitalSigns extends Omit<VitalSignsResponse, "temperatureCelsius" | "weightKg" | "heightCm"> {
  temperatureCelsius: number | null;
  weightKg: number | null;
  heightCm: number | null;
}

/** Body of POST /visits/:id/vitals. Strict on the backend: only these keys, all optional. */
export interface RecordVitalsBody {
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  pulseBpm?: number;
  temperatureCelsius?: number;
  weightKg?: number;
  heightCm?: number;
  respiratoryRate?: number;
  oxygenSaturationPct?: number;
  notes?: string;
}

export interface NursingAssessment {
  id: string;
  visitId: string;
  nurseId: string;
  chiefComplaint: string | null;
  assessmentNotes: string | null;
  createdAt: string;
}

/** Body of POST /visits/:id/nursing-assessment. Strict: only these keys, both optional. */
export interface RecordAssessmentBody {
  chiefComplaint?: string;
  assessmentNotes?: string;
}
