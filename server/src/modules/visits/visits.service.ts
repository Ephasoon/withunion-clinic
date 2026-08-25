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

/**
 * Creates a visit for an existing patient. This is the "__new__" →
 * REGISTERED transition described in QUEUE_TRANSITIONS (reception
 * only, enforced by the route's requireRole) — modeled here as a
 * dedicated creation path rather than routed through the generic
 * transition endpoint, since there is no existing visit id yet.
 * Runs in a transaction: the visit row and its first queue_events
 * row are written together or not at all.
 */
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

/**
 * Statuses a given role can act on right now, derived directly from
 * QUEUE_TRANSITIONS (the existing Phase 2 RBAC source of truth)
 * rather than a separately maintained list — so this can never drift
 * out of sync with what canTransition() actually allows.
 */
function relevantFromStatuses(role: Role): string[] | null {
  if (role === "owner" || role === "reception") {
    return null; // null = no status filter, full visibility
  }
  const statuses = QUEUE_TRANSITIONS[role]
    .map((t) => t.from)
    .filter((from) => from !== "*" && from !== "__new__");
  return Array.from(new Set(statuses));
}

/**
 * "Today's queue" — reception/owner see every visit created today;
 * every other role sees only visits currently sitting in a status
 * that belongs to their step, so a nurse's screen doesn't fill up
 * with patients waiting on the doctor or pharmacy (Phase 1 §7/§8).
 */
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
 * The single state-changing entrypoint every module (nursing,
 * consultation, etc.) will call in later Phase 3 steps — matches the
 * approved plan's "one endpoint every stage-change goes through"
 * design (§3.2). Enforces, in order:
 *  1. the visit exists,
 *  2. it isn't already in a terminal state (COMPLETED/CANCELLED) —
 *     a stricter guard than QUEUE_TRANSITIONS' role table alone
 *     provides, since a role's "*" wildcard entry (e.g. reception's
 *     cancel-from-anywhere) does not by itself exclude terminal
 *     states; that exclusion is applied here,
 *  3. the requesting role is allowed to make this specific
 *     from→to transition, per canTransition() (unchanged from Phase 2),
 *  4. a reason is present when cancelling.
 */
export async function transitionVisit(
  visitId: string,
  role: Role,
  toStatus: VisitStatus,
  reason: string | undefined,
  changedBy: string
): Promise<Visit> {
  const visit = await getVisitById(visitId);
  if (!visit) {
    throw new AppError(404, "NOT_FOUND", "Visit not found");
  }

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

  if (toStatus === "CANCELLED" && !reason) {
    throw new AppError(400, "VALIDATION_ERROR", "reason is required to cancel a visit");
  }

  return withTransaction(async (client: PoolClient) => {
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
  });
}
