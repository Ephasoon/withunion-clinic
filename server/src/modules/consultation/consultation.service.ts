import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { getVisitById, transitionVisit } from "../visits/visits.service";
import { CreateLabOrderInput, CreatePrescriptionInput } from "./consultation.schema";

export interface Consultation {
  id: string;
  visitId: string;
  doctorId: string;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface Diagnosis {
  id: string;
  consultationId: string;
  description: string;
  createdAt: string;
}

export interface LabOrder {
  id: string;
  visitId: string;
  consultationId: string;
  requestedBy: string;
  status: string;
  requestedAt: string;
  testNames: string[];
}

export interface Prescription {
  id: string;
  visitId: string;
  consultationId: string;
  doctorId: string;
  createdAt: string;
  items: Array<{
    id: string;
    medicineName: string;
    strength: string | null;
    dosage: string | null;
    frequency: string | null;
    duration: string | null;
    quantityPrescribed: number | null;
    status: string;
  }>;
}

interface ConsultationRow {
  id: string;
  visit_id: string;
  doctor_id: string;
  notes: string | null;
  started_at: string;
  completed_at: string | null;
}

function toConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    visitId: row.visit_id,
    doctorId: row.doctor_id,
    notes: row.notes,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

/**
 * Opening a consultation creates the record and, if needed, advances
 * the visit into WITH_DOCTOR — but the existing (unmodified) state
 * graph has two distinct ways a visit arrives at the doctor's step:
 *  - first consultation: visit is WAITING_FOR_DOCTOR (nurse hand-off),
 *    so opening the consultation fires that transition itself, same
 *    as Nursing's assessment firing its own hand-off;
 *  - a review consultation after lab results: the existing
 *    LAB_COMPLETED -> WITH_DOCTOR transition (already in
 *    QUEUE_TRANSITIONS, fired via the ordinary transition endpoint
 *    before this is called) lands the visit directly on WITH_DOCTOR,
 *    never back on WAITING_FOR_DOCTOR — so in that case the
 *    consultation record is simply created with no further
 *    transition, since the visit is already where it needs to be.
 * Either way, this function only decides whether transitionVisit()
 * needs to be called at all — it never invents a transition that
 * doesn't already exist in the Visits module's own table.
 *
 * Guards against a second simultaneously-open consultation on the
 * same visit: the approved design ("each doctor touch/review is a
 * separate consultation") means sequential, non-overlapping rows —
 * not concurrently open ones. Checked here at the application level
 * AND enforced at the database level by a partial unique index on
 * visit_id WHERE completed_at IS NULL (see the migration), following
 * the same "unique constraint rather than application code alone"
 * precedent already established by nursing_assessments.
 */
export async function openConsultation(visitId: string, doctorId: string): Promise<Consultation> {
  const visit = await getVisitById(visitId);
  if (!visit) {
    throw new AppError(404, "NOT_FOUND", "Visit not found");
  }
  if (visit.status !== "WAITING_FOR_DOCTOR" && visit.status !== "WITH_DOCTOR") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `A consultation can only be opened while the visit is WAITING_FOR_DOCTOR or WITH_DOCTOR (currently ${visit.status})`
    );
  }

  const existingOpen = await pool.query<{ id: string }>(
    `SELECT id FROM consultations WHERE visit_id = $1 AND completed_at IS NULL LIMIT 1`,
    [visitId]
  );
  if ((existingOpen.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      "CONSULTATION_ALREADY_OPEN",
      "This visit already has an open consultation — complete it before opening another"
    );
  }

  let result;
  try {
    result = await pool.query<ConsultationRow>(
      `INSERT INTO consultations (visit_id, doctor_id) VALUES ($1, $2) RETURNING *`,
      [visitId, doctorId]
    );
  } catch (err) {
    // Belt-and-suspenders: the partial unique index catches a race
    // between the check above and this insert (two concurrent
    // requests both passing the check before either commits).
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError(
        409,
        "CONSULTATION_ALREADY_OPEN",
        "This visit already has an open consultation — complete it before opening another"
      );
    }
    throw err;
  }
  const consultation = toConsultation(result.rows[0]);

  if (visit.status === "WAITING_FOR_DOCTOR") {
    await transitionVisit(visitId, "doctor", "WITH_DOCTOR", undefined, doctorId);
  }

  return consultation;
}

export async function getConsultationById(id: string): Promise<Consultation | null> {
  const result = await pool.query<ConsultationRow>(`SELECT * FROM consultations WHERE id = $1`, [id]);
  return result.rows[0] ? toConsultation(result.rows[0]) : null;
}

/**
 * Every write against an existing consultation shares two checks:
 * the requesting doctor must be the one who opened it ("own record
 * only", per the approved plan's PATCH rule — applied uniformly here
 * so one doctor can never add diagnoses/orders/prescriptions into
 * another doctor's open consultation), and the consultation must not
 * already be completed.
 */
async function requireOwnOpenConsultation(consultationId: string, doctorId: string): Promise<Consultation> {
  const consultation = await getConsultationById(consultationId);
  if (!consultation) {
    throw new AppError(404, "NOT_FOUND", "Consultation not found");
  }
  if (consultation.doctorId !== doctorId) {
    throw new AppError(403, "FORBIDDEN", "You can only modify your own consultation record");
  }
  if (consultation.completedAt) {
    throw new AppError(409, "CONSULTATION_COMPLETED", "This consultation has already been completed");
  }
  return consultation;
}

export async function updateConsultationNotes(
  consultationId: string,
  doctorId: string,
  notes: string
): Promise<Consultation> {
  await requireOwnOpenConsultation(consultationId, doctorId);
  const result = await pool.query<ConsultationRow>(
    `UPDATE consultations SET notes = $1 WHERE id = $2 RETURNING *`,
    [notes, consultationId]
  );
  return toConsultation(result.rows[0]);
}

export async function createDiagnosis(
  consultationId: string,
  doctorId: string,
  description: string
): Promise<Diagnosis> {
  await requireOwnOpenConsultation(consultationId, doctorId);
  const result = await pool.query<{
    id: string;
    consultation_id: string;
    description: string;
    created_at: string;
  }>(
    `INSERT INTO diagnoses (consultation_id, description) VALUES ($1, $2) RETURNING *`,
    [consultationId, description]
  );
  const row = result.rows[0];
  return { id: row.id, consultationId: row.consultation_id, description: row.description, createdAt: row.created_at };
}

/**
 * Creates a lab order + its items. This is a record-only action —
 * status starts at REQUESTED and nothing here processes results;
 * fulfillment is out of scope until the Laboratory phase.
 *
 * FIX (post-20a12d0 correction): the order-row insert and the
 * items-insert now run inside a single withTransaction() call, using
 * the same client for both statements — matching the pattern already
 * established by visits.service.ts's createVisit(). Previously these
 * were two independent pool.query() calls; a failure between them
 * (e.g. a dropped connection) could have left a laboratory_orders row
 * with zero items. No schema, RBAC, validation, or response-shape
 * change — this is purely an atomicity correction.
 */
export async function createLabOrder(
  consultationId: string,
  doctorId: string,
  input: CreateLabOrderInput
): Promise<LabOrder> {
  const consultation = await requireOwnOpenConsultation(consultationId, doctorId);

  return withTransaction(async (client: PoolClient) => {
    const orderResult = await client.query<{
      id: string;
      visit_id: string;
      consultation_id: string;
      requested_by: string;
      status: string;
      requested_at: string;
    }>(
      `INSERT INTO laboratory_orders (visit_id, consultation_id, requested_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [consultation.visitId, consultationId, doctorId]
    );
    const order = orderResult.rows[0];

    const itemValues: string[] = [];
    const params: unknown[] = [order.id];
    input.testNames.forEach((name, i) => {
      itemValues.push(`($1, $${i + 2})`);
      params.push(name);
    });
    await client.query(
      `INSERT INTO laboratory_order_items (order_id, test_name) VALUES ${itemValues.join(", ")}`,
      params
    );

    return {
      id: order.id,
      visitId: order.visit_id,
      consultationId: order.consultation_id,
      requestedBy: order.requested_by,
      status: order.status,
      requestedAt: order.requested_at,
      testNames: input.testNames,
    };
  });
}

/**
 * Creates a prescription + its items. Record-only — dispensing and
 * inventory deduction are out of scope until the Pharmacy phase.
 * medicineName is free text (see migration/schema comments).
 *
 * FIX (post-20a12d0 correction): the prescription-row insert and the
 * per-item inserts (previously N+1 separate pool.query() calls, the
 * worst version of the atomicity gap — a failure on any item left a
 * partially-populated prescription) now all run on the same client
 * inside a single withTransaction() call. Same pattern as
 * createLabOrder() above and createVisit() in visits.service.ts. No
 * schema, RBAC, validation, or response-shape change.
 */
export async function createPrescription(
  consultationId: string,
  doctorId: string,
  input: CreatePrescriptionInput
): Promise<Prescription> {
  const consultation = await requireOwnOpenConsultation(consultationId, doctorId);

  return withTransaction(async (client: PoolClient) => {
    const prescriptionResult = await client.query<{
      id: string;
      visit_id: string;
      consultation_id: string;
      doctor_id: string;
      created_at: string;
    }>(
      `INSERT INTO prescriptions (visit_id, consultation_id, doctor_id) VALUES ($1, $2, $3) RETURNING *`,
      [consultation.visitId, consultationId, doctorId]
    );
    const prescription = prescriptionResult.rows[0];

    const items = [];
    for (const item of input.items) {
      const itemResult = await client.query<{
        id: string;
        medicine_name: string;
        strength: string | null;
        dosage: string | null;
        frequency: string | null;
        duration: string | null;
        quantity_prescribed: number | null;
        status: string;
      }>(
        `INSERT INTO prescription_items
           (prescription_id, medicine_name, strength, dosage, frequency, duration, quantity_prescribed)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          prescription.id,
          item.medicineName,
          item.strength ?? null,
          item.dosage ?? null,
          item.frequency ?? null,
          item.duration ?? null,
          item.quantityPrescribed ?? null,
        ]
      );
      const row = itemResult.rows[0];
      items.push({
        id: row.id,
        medicineName: row.medicine_name,
        strength: row.strength,
        dosage: row.dosage,
        frequency: row.frequency,
        duration: row.duration,
        quantityPrescribed: row.quantity_prescribed,
        status: row.status,
      });
    }

    return {
      id: prescription.id,
      visitId: prescription.visit_id,
      consultationId: prescription.consultation_id,
      doctorId: prescription.doctor_id,
      createdAt: prescription.created_at,
      items,
    };
  });
}

export async function getDiagnosesForConsultation(consultationId: string): Promise<Diagnosis[]> {
  const result = await pool.query<{
    id: string;
    consultation_id: string;
    description: string;
    created_at: string;
  }>(`SELECT * FROM diagnoses WHERE consultation_id = $1 ORDER BY created_at ASC`, [consultationId]);
  return result.rows.map((row) => ({
    id: row.id,
    consultationId: row.consultation_id,
    description: row.description,
    createdAt: row.created_at,
  }));
}

async function hasLabOrders(consultationId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM laboratory_orders WHERE consultation_id = $1 LIMIT 1`, [
    consultationId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

async function hasPrescriptions(consultationId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM prescriptions WHERE consultation_id = $1 LIMIT 1`, [
    consultationId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Completes the consultation and advances the visit, choosing the
 * target status from what was actually created in this consultation
 * (Phase 1 §4.1's branching): a lab order takes priority (doctor
 * still needs the result before pharmacy/billing), then a
 * prescription, then straight to billing if neither exists. The
 * transition itself goes through the existing transitionVisit() —
 * this function only decides which target status to request.
 *
 * The transition is attempted before completed_at is written, so a
 * visit already in an unexpected state never leaves a consultation
 * marked complete without the visit having actually moved.
 */
export async function completeConsultation(
  consultationId: string,
  doctorId: string
): Promise<{ consultation: Consultation; visitStatus: string }> {
  const consultation = await requireOwnOpenConsultation(consultationId, doctorId);

  const [labOrdered, prescribed] = await Promise.all([
    hasLabOrders(consultationId),
    hasPrescriptions(consultationId),
  ]);

  const targetStatus = labOrdered ? "WAITING_FOR_LAB" : prescribed ? "WAITING_FOR_PHARMACY" : "WAITING_FOR_BILLING";

  const visit = await transitionVisit(consultation.visitId, "doctor", targetStatus, undefined, doctorId);

  const result = await pool.query<ConsultationRow>(
    `UPDATE consultations SET completed_at = now() WHERE id = $1 RETURNING *`,
    [consultationId]
  );

  return { consultation: toConsultation(result.rows[0]), visitStatus: visit.status };
}
