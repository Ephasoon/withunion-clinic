import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { transitionVisit } from "../visits/visits.service";
import { EnterResultsInput } from "./laboratory.schema";

export interface LabOrderItem {
  id: string;
  testName: string;
  result: string | null;
  resultEnteredBy: string | null;
  resultEnteredAt: string | null;
}

export interface LabOrderDetail {
  id: string;
  visitId: string;
  consultationId: string;
  requestedBy: string;
  requestedByName: string;
  status: string;
  requestedAt: string;
  visitStatus: string;
  patientCode: string;
  patientFullName: string;
  items: LabOrderItem[];
}

interface OrderRow {
  id: string;
  visit_id: string;
  consultation_id: string;
  requested_by: string;
  requested_by_name: string;
  status: string;
  requested_at: string;
  visit_status: string;
  patient_code: string;
  patient_full_name: string;
}

interface ItemRow {
  id: string;
  order_id: string;
  test_name: string;
  result: string | null;
  result_entered_by: string | null;
  result_entered_at: string | null;
}

const ORDER_SELECT = `
  SELECT lo.id, lo.visit_id, lo.consultation_id, lo.requested_by, u.full_name AS requested_by_name,
         lo.status, lo.requested_at, v.status AS visit_status, p.patient_code, p.full_name AS patient_full_name
  FROM laboratory_orders lo
  JOIN visits v ON v.id = lo.visit_id
  JOIN patients p ON p.id = v.patient_id
  JOIN users u ON u.id = lo.requested_by
`;

function toItem(row: ItemRow): LabOrderItem {
  return {
    id: row.id,
    testName: row.test_name,
    result: row.result,
    resultEnteredBy: row.result_entered_by,
    resultEnteredAt: row.result_entered_at,
  };
}

async function getItemsForOrder(orderId: string): Promise<LabOrderItem[]> {
  const result = await pool.query<ItemRow>(
    `SELECT * FROM laboratory_order_items WHERE order_id = $1 ORDER BY test_name ASC`,
    [orderId]
  );
  return result.rows.map(toItem);
}

async function toDetail(row: OrderRow): Promise<LabOrderDetail> {
  const items = await getItemsForOrder(row.id);
  return {
    id: row.id,
    visitId: row.visit_id,
    consultationId: row.consultation_id,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name,
    status: row.status,
    requestedAt: row.requested_at,
    visitStatus: row.visit_status,
    patientCode: row.patient_code,
    patientFullName: row.patient_full_name,
    items,
  };
}

export async function getLabOrderDetail(orderId: string): Promise<LabOrderDetail | null> {
  const result = await pool.query<OrderRow>(`${ORDER_SELECT} WHERE lo.id = $1`, [orderId]);
  if (!result.rows[0]) return null;
  return toDetail(result.rows[0]);
}

/**
 * "Pending/current" laboratory work for the technician's queue —
 * orders whose visit is still WAITING_FOR_LAB or AT_LAB. Per the
 * approved scope, laboratory_orders.status itself is left untouched
 * (always REQUESTED); the visit's status is the authoritative signal
 * for what's pending, so this filters on that instead of introducing
 * a second state to keep in sync.
 */
export async function listPendingLabOrders(): Promise<LabOrderDetail[]> {
  const result = await pool.query<OrderRow>(
    `${ORDER_SELECT} WHERE v.status IN ('WAITING_FOR_LAB', 'AT_LAB') ORDER BY lo.requested_at ASC`
  );
  return Promise.all(result.rows.map(toDetail));
}

/**
 * WAITING_FOR_LAB -> AT_LAB, via the existing transitionVisit() —
 * no new transition logic, no manual queue_events write here.
 */
export async function startLabWork(orderId: string, labTechId: string): Promise<LabOrderDetail> {
  const order = await getLabOrderDetail(orderId);
  if (!order) {
    throw new AppError(404, "NOT_FOUND", "Laboratory order not found");
  }
  if (order.visitStatus !== "WAITING_FOR_LAB") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Laboratory work can only start while the visit is WAITING_FOR_LAB (currently ${order.visitStatus})`
    );
  }

  await transitionVisit(order.visitId, "lab_tech", "AT_LAB", undefined, labTechId);

  return (await getLabOrderDetail(orderId))!;
}

export interface EnterResultsOutcome {
  order: LabOrderDetail;
  /** Per-item create/update classification, for the route layer's audit calls. */
  writes: Array<{ itemId: string; wasCreate: boolean }>;
}

/**
 * Enters or updates results for one or more items on an order.
 * Requirements enforced here (Laboratory V1 spec §7.D):
 *  - the visit must be AT_LAB (not before, not after LAB_COMPLETED —
 *    the same visit-status check that protects completed results
 *    from further edits, since AT_LAB is a strict precondition, not
 *    just an initial one);
 *  - every itemId must belong to this specific order (rejects a
 *    foreign item from a different order);
 *  - the whole batch is one transaction — a failure partway through
 *    rolls back everything already written in this call, per the
 *    project's established withTransaction pattern (Visits'
 *    createVisit, Consultation's createLabOrder/createPrescription).
 * All statements inside the transaction use the same client — no
 * mixing with pool.query, as required.
 */
export async function enterResults(
  orderId: string,
  labTechId: string,
  input: EnterResultsInput
): Promise<EnterResultsOutcome> {
  const order = await getLabOrderDetail(orderId);
  if (!order) {
    throw new AppError(404, "NOT_FOUND", "Laboratory order not found");
  }
  if (order.visitStatus !== "AT_LAB") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Results can only be entered while the visit is AT_LAB (currently ${order.visitStatus})`
    );
  }

  const existingById = new Map(order.items.map((item) => [item.id, item]));
  for (const entry of input.results) {
    if (!existingById.has(entry.itemId)) {
      throw new AppError(
        400,
        "ITEM_NOT_IN_ORDER",
        `Item ${entry.itemId} does not belong to laboratory order ${orderId}`
      );
    }
  }

  const writes = input.results.map((entry) => ({
    itemId: entry.itemId,
    wasCreate: existingById.get(entry.itemId)!.result === null,
  }));

  await withTransaction(async (client: PoolClient) => {
    for (const entry of input.results) {
      await client.query(
        `UPDATE laboratory_order_items
         SET result = $1, result_entered_by = $2, result_entered_at = now()
         WHERE id = $3 AND order_id = $4`,
        [entry.result, labTechId, entry.itemId, orderId]
      );
    }
  });

  const updatedOrder = (await getLabOrderDetail(orderId))!;
  return { order: updatedOrder, writes };
}

/**
 * Verifies every requested item has a non-empty result, then fires
 * the existing AT_LAB -> LAB_COMPLETED transition. laboratory_orders.status
 * is deliberately left untouched (still REQUESTED) — the visit's
 * status is the single source of truth for workflow state, per the
 * approved scope (no second state machine to keep in sync).
 */
export async function completeLabOrder(orderId: string, labTechId: string): Promise<LabOrderDetail> {
  const order = await getLabOrderDetail(orderId);
  if (!order) {
    throw new AppError(404, "NOT_FOUND", "Laboratory order not found");
  }
  if (order.visitStatus !== "AT_LAB") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Laboratory work can only be completed while the visit is AT_LAB (currently ${order.visitStatus})`
    );
  }

  const missing = order.items.filter((item) => !item.result || item.result.trim() === "");
  if (missing.length > 0) {
    throw new AppError(
      409,
      "INCOMPLETE_RESULTS",
      `Cannot complete: missing results for ${missing.map((i) => i.testName).join(", ")}`
    );
  }

  await transitionVisit(order.visitId, "lab_tech", "LAB_COMPLETED", undefined, labTechId);

  return (await getLabOrderDetail(orderId))!;
}