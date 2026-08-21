import { pool } from "../../config/db";
import { CreatePatientInput, UpdatePatientInput } from "./patients.schema";

export interface Patient {
  id: string;
  patientCode: string;
  fullName: string;
  gender: string;
  dateOfBirth: string | null;
  approximateAge: number | null;
  phone: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PatientRow {
  id: string;
  patient_code: string;
  full_name: string;
  gender: string;
  date_of_birth: string | null;
  approximate_age: number | null;
  phone: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    patientCode: row.patient_code,
    fullName: row.full_name,
    gender: row.gender,
    dateOfBirth: row.date_of_birth,
    approximateAge: row.approximate_age,
    phone: row.phone,
    address: row.address,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    status: row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generates the next sequential patient code, e.g. WU-000123.
 * Backed by a dedicated DB sequence (patient_code_seq) rather than
 * counting existing rows, so it stays correct even if a patient
 * record is ever deactivated — codes are never reused or gapless-
 * guaranteed beyond what the sequence itself provides.
 */
async function nextPatientCode(): Promise<string> {
  const result = await pool.query<{ nextval: string }>("SELECT nextval('patient_code_seq') AS nextval");
  const n = Number(result.rows[0].nextval);
  return `WU-${String(n).padStart(6, "0")}`;
}

export async function createPatient(input: CreatePatientInput, createdBy: string): Promise<Patient> {
  const patientCode = await nextPatientCode();
  const result = await pool.query<PatientRow>(
    `INSERT INTO patients
       (patient_code, full_name, gender, date_of_birth, approximate_age, phone, address,
        emergency_contact_name, emergency_contact_phone, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      patientCode,
      input.fullName,
      input.gender,
      input.dateOfBirth ?? null,
      input.approximateAge ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.emergencyContactName ?? null,
      input.emergencyContactPhone ?? null,
      input.notes ?? null,
      createdBy,
    ]
  );
  return toPatient(result.rows[0]);
}

/**
 * Search/dedupe lookup (Phase 1 §5): exact phone match first,
 * then fuzzy name match, so reception can see "is this patient
 * already registered?" candidates without the system auto-merging
 * anything. Returns candidates for a human to decide — never
 * silently treats two rows as the same patient.
 */
export async function searchPatients(search: string | undefined, limit: number): Promise<Patient[]> {
  if (!search) {
    const result = await pool.query<PatientRow>(
      `SELECT * FROM patients WHERE status = 'active' ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(toPatient);
  }

  const digitsOnly = search.replace(/\D/g, "");
  const result = await pool.query<PatientRow>(
    `SELECT *,
            CASE WHEN $2 <> '' AND phone LIKE '%' || $2 || '%' THEN 0 ELSE 1 END AS match_rank
     FROM patients
     WHERE status = 'active'
       AND (
         ($2 <> '' AND phone LIKE '%' || $2 || '%')
         OR full_name ILIKE '%' || $1 || '%'
       )
     ORDER BY match_rank ASC, full_name ASC
     LIMIT $3`,
    [search, digitsOnly, limit]
  );
  return result.rows.map(toPatient);
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const result = await pool.query<PatientRow>(`SELECT * FROM patients WHERE id = $1`, [id]);
  return result.rows[0] ? toPatient(result.rows[0]) : null;
}

export async function updatePatient(id: string, input: UpdatePatientInput): Promise<Patient | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const columnMap: Record<string, string> = {
    fullName: "full_name",
    gender: "gender",
    dateOfBirth: "date_of_birth",
    approximateAge: "approximate_age",
    phone: "phone",
    address: "address",
    emergencyContactName: "emergency_contact_name",
    emergencyContactPhone: "emergency_contact_phone",
    notes: "notes",
    status: "status",
  };

  for (const [key, column] of Object.entries(columnMap)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      fields.push(`${column} = $${i}`);
      values.push(value);
      i++;
    }
  }

  if (fields.length === 0) {
    return getPatientById(id);
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await pool.query<PatientRow>(
    `UPDATE patients SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return result.rows[0] ? toPatient(result.rows[0]) : null;
}
