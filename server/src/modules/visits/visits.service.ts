import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { canTransition, QUEUE_TRANSITIONS, Role } from "../roles/roles";
import { getPatientById } from "../patients/patients.service";
import { TERMINAL_STATUSES, VisitStatus } from "./visits.schema";

export interface Visit {
  id: string;
  patientId: string;
  patientCode: string;
  patientFullName: string;
  status: VisitStatus;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface QueueEvent {
  id: string;
  visitId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

interface VisitRow {
  id: string;
  patient_id: string;
  patient_code: string;
  patient_full_name: string;
  status: string;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

interface QueueEventRow {
  id: string;
  visit_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  reason: string | null;
  changed_at: string;
}

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientFullName: row.patient_full_name,
    status: row.status as VisitStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
  };
}

function toQueueEvent(row: QueueEventRow): QueueEvent {
  return {
    id: row.id,
    visitId: row.visit_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedBy: row.changed_by,
    reason: row.reason,
    changedAt: row.changed_at,
  };
}

const VISIT_SELECT = `
  SELECT v.id, v.patient_id, p.patient_code, p.full_name AS patient_full_name,
         v.status, v.created_by, v.created_at, v.completed_at, v.cancelled_at, v.cancel_reason
  FROM visits v
  JOIN patients p ON p.id = v.patient_id
`;

export async function createVisit(patientId: string, createdBy: string): Promise<Visit> {
  const patient = await getPatientById(patientId);
  if (!patient) {
    throw new AppError(404, "NOT_FOUND", "Patient not found");
  }

  return withTransaction(async (client: PoolClient) => {
    const insertVisit = await client.query<{ id: string }>(
      `INSERT INTO visits (patient_id, status, created_by) VALUES ($1, 'REGISTERED', $2) RETURNING id`,
      [patientId, createdBy]
    );
    const visitId = insertVisit.rows[0].id;

    await client.query(
      `INSERT INTO queue_events (visit_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, 'REGISTERED', $2, NULL)`,
      [visitId, createdBy]
    );

    const result = await client.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [visitId]);
    return toVisit(result.rows[0]);
  });
}

export async function getVisitById(id: string): Promise<Visit | null> {
  const result = await pool.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [id]);
  return result.rows[0] ? toVisit(result.rows[0]) : null;
}

export async function getVisitHistory(visitId: string): Promise<QueueEvent[]> {
  const result = await pool.query<QueueEventRow>(
    `SELECT * FROM queue_events WHERE visit_id = $1 ORDER BY changed_at ASC`,
    [visitId]
  );
  return result.rows.map(toQueueEvent);
}

function relevantFromStatuses(role: Role): string[] | null {
  if (role === "owner" || role === "reception") {
    return null;
  }
  const statuses = QUEUE_TRANSITIONS[role]
    .map((t) => t.from)
    .filter((from) => from !== "*" && from !== "__new__");
  return Array.from(new Set(statuses));
}

export async function listTodayVisits(role: Role): Promise<Visit[]> {
  const statuses = relevantFromStatuses(role);

  if (statuses === null) {
    const result = await pool.query<VisitRow>(
      `${VISIT_SELECT} WHERE v.created_at >= CURRENT_DATE ORDER BY v.created_at ASC`
    );
    return result.rows.map(toVisit);
  }

  if (statuses.length === 0) {
    return [];
  }

  const result = await pool.query<VisitRow>(
    `${VISIT_SELECT} WHERE v.created_at >= CURRENT_DATE AND v.status = ANY($1) ORDER BY v.created_at ASC`,
    [statuses]
  );
  return result.rows.map(toVisit);
}

/**
 * Core transition logic, parameterized on an already-open client
 * rather than opening its own transaction. Extracted so a caller that
 * needs the transition to participate in a larger transaction (e.g.
 * Billing's invoice-PAID + visit-COMPLETED write) can call it inside
 * their own withTransaction() block. Identical checks, identical SQL,
 * identical error codes/order to what transitionVisit() always did —
 * the only difference from before is that the initial visit read now
 * happens on the transactional client instead of via `pool` ahead of
 * the transaction, which closes a small pre-existing TOCTOU gap and
 * is not an observable behavior change for any caller.
 */
async function transitionVisitCore(
  client: PoolClient,
  visitId: string,
  role: Role,
  toStatus: VisitStatus,
  reason: string | undefined,
  changedBy: string,
  allowCompletion: boolean
): Promise<Visit> {
  const visitResult = await client.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [visitId]);
  if (!visitResult.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Visit not found");
  }
  const visit = toVisit(visitResult.rows[0]);

  if (TERMINAL_STATUSES.includes(visit.status)) {
    throw new AppError(409, "VISIT_TERMINAL", `Visit is already ${visit.status} and cannot be changed further`);
  }

  if (!canTransition(role, visit.status, toStatus)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `Your role cannot move a visit from ${visit.status} to ${toStatus}`
    );
  }

  // COMPLETED is owned by Billing's completion flow. canTransition()
  // alone can't enforce that — the generic endpoint and Billing both
  // act as "reception" — so completion additionally requires the
  // billing entry point (allowCompletion) AND a PAID invoice visible
  // on this same client (Billing marks it PAID in this transaction).
  if (toStatus === "COMPLETED") {
    if (!allowCompletion) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "A visit can only be completed through billing completion"
      );
    }
    const paid = await client.query(`SELECT 1 FROM invoices WHERE visit_id = $1 AND status = 'PAID'`, [visitId]);
    if (!paid.rows[0]) {
      throw new AppError(403, "FORBIDDEN", "A visit cannot be completed without a PAID invoice");
    }
  }

  if (toStatus === "CANCELLED" && !reason) {
    throw new AppError(400, "VALIDATION_ERROR", "reason is required to cancel a visit");
  }

  await client.query(
    `UPDATE visits
     SET status = $1::varchar,
         completed_at = CASE WHEN $1::varchar = 'COMPLETED' THEN now() ELSE completed_at END,
         cancelled_at = CASE WHEN $1::varchar = 'CANCELLED' THEN now() ELSE cancelled_at END,
         cancel_reason = CASE WHEN $1::varchar = 'CANCELLED' THEN $2::text ELSE cancel_reason END
     WHERE id = $3`,
    [toStatus, reason ?? null, visitId]
  );

  await client.query(
    `INSERT INTO queue_events (visit_id, from_status, to_status, changed_by, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [visitId, visit.status, toStatus, changedBy, reason ?? null]
  );

  const result = await client.query<VisitRow>(`${VISIT_SELECT} WHERE v.id = $1`, [visitId]);
  return toVisit(result.rows[0]);
}

/**
 * Unchanged public API — signature, behavior, atomicity guarantee,
 * and every existing caller (Nursing, Consultation, Laboratory,
 * Pharmacy, the generic /visits/:id/transition route) are unaffected
 * by this refactor. Simply opens its own transaction and delegates
 * to the extracted core.
 */
export async function transitionVisit(
  visitId: string,
  role: Role,
  toStatus: VisitStatus,
  reason: string | undefined,
  changedBy: string
): Promise<Visit> {
  return withTransaction((client: PoolClient) =>
    transitionVisitCore(client, visitId, role, toStatus, reason, changedBy, false)
  );
}

/**
 * For a caller that already holds a PoolClient inside its own
 * withTransaction() block and needs this transition to be part of
 * that same SQL transaction (currently: Billing's completion step).
 * Does not open or close a transaction itself — the caller owns
 * that lifecycle. This is the only entry point permitted to move a
 * visit to COMPLETED, and only once its invoice is PAID.
 */
export async function transitionVisitWithClient(
  client: PoolClient,
  visitId: string,
  role: Role,
  toStatus: VisitStatus,
  reason: string | undefined,
  changedBy: string
): Promise<Visit> {
  return transitionVisitCore(client, visitId, role, toStatus, reason, changedBy, true);
}
