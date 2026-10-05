/** docs/api-inventory.md §4 Patient and §5.3 CreatePatientSchema. */

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = { male: "Male", female: "Female", other: "Other" };

export const PATIENT_STATUSES = ["active", "inactive"] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export interface Patient {
  id: string;
  /** "WU-000123" */
  patientCode: string;
  fullName: string;
  gender: Gender;
  /** Plain calendar date "YYYY-MM-DD" — never convert with Date. */
  dateOfBirth: string | null;
  approximateAge: number | null;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: PatientStatus;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /api/v1/patients. Strict on the backend: only these keys. */
export interface CreatePatientBody {
  fullName: string;
  gender: Gender;
  dateOfBirth?: string;
  approximateAge?: number;
  phone?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
}

/**
 * Body of PATCH /api/v1/patients/:id (docs §5.3): every create field
 * optional, plus status. Strict; no field accepts null (docs §7.6).
 */
export type UpdatePatientBody = Partial<CreatePatientBody> & { status?: PatientStatus };
