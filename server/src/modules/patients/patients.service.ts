import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { normalizePhone, phoneNormalizeSql } from "../../utils/phone";
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
async function nextPatientCode(client: PoolClient): Promise<string> {
  const result = await client.query<{ nextval: string }>("SELECT nextval('patient_code_seq') AS nextval");
  const n = Number(result.rows[0].nextval);
  return `WU-${String(n).padStart(6, "0")}`;
}

/**
 * A patient's own phone must be unique across ALL patients, active and
 * inactive, compared by normalizePhone() (utils/phone.ts). A blank or
 * too-short phone never conflicts; names and the emergency contact
 * phone are not checked. excludeId leaves out the patient being edited.
 *
 * Runs inside the caller's insert/update transaction, but there is NO
 * unique index behind it (dev data already holds duplicates), so two
 * concurrent requests with the same number can both pass the check and
 * both commit — a known race, documented in docs/api-inventory.md §5.3.
 *
 * If legacy duplicates exist, the active one is reported first, then
 * the oldest.
 */
async function assertPhoneAvailable(client: PoolClient, phone: string | undefined, excludeId?: string): Promise<void> {
  const normalized = normalizePhone(phone);
  if (normalized === null) return;
  const existing = await client.query<Pick<PatientRow, "id" | "patient_code" | "full_name">>(
    `SELECT id, patient_code, full_name FROM patients
     WHERE phone IS NOT NULL AND ${phoneNormalizeSql("phone")} = $1
       AND ($2::uuid IS NULL OR id <> $2)
     ORDER BY (status = 'active') DESC, created_at ASC
     LIMIT 1`,
    [normalized, excludeId ?? null]
  );
  const match = existing.rows[0];
  if (match) {
    throw new AppError(
      409,
      "PATIENT_PHONE_ALREADY_EXISTS",
      `This phone number already belongs to ${match.full_name} (${match.patient_code})`,
      { patientId: match.id, patientCode: match.patient_code, fullName: match.full_name }
    );
  }
}

export async function createPatient(input: CreatePatientInput, createdBy: string): Promise<Patient> {
  return withTransaction(async (client) => {
    await assertPhoneAvailable(client, input.phone);
    const patientCode = await nextPatientCode(client);
    const result = await client.query<PatientRow>(
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
  });
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

/**
 * The phone is checked only when it actually changes: a PATCH whose
 * phone normalizes to the patient's current number (e.g. re-sending it,
 * or re-formatting "0935 259 622" as "0935259622") is not a change, so a
 * legacy duplicate can still have its other fields edited. Moving onto
 * another patient's number is always refused.
 */
export async function updatePatient(id: string, input: UpdatePatientInput): Promise<Patient | null> {
  return withTransaction(async (client) => {
    const current = await client.query<PatientRow>(`SELECT * FROM patients WHERE id = $1 FOR UPDATE`, [id]);
    if (!current.rows[0]) return null;
    if (input.phone !== undefined && normalizePhone(input.phone) !== normalizePhone(current.rows[0].phone)) {
      await assertPhoneAvailable(client, input.phone, id);
    }

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
      return toPatient(current.rows[0]);
    }

    fields.push(`updated_at = now()`);
    values.push(id);

    const result = await client.query<PatientRow>(
      `UPDATE patients SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] ? toPatient(result.rows[0]) : null;
  });
}
