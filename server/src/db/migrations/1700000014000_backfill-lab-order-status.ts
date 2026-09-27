import { MigrationBuilder } from "node-pg-migrate";

/**
 * Data-only backfill for the multi-order lab fix. Until now
 * laboratory_orders.status was never written (always REQUESTED);
 * completeLabOrder() now marks every order in a finished lab round
 * COMPLETED, and REQUESTED means "outstanding". Existing rows need the
 * same meaning, or a visit's already-finished orders would count as
 * outstanding forever.
 *
 * Rule: an order is COMPLETED iff its own visit reached LAB_COMPLETED
 * strictly AFTER the order was requested — i.e. a lab round closed
 * while it existed. An order requested after the visit's last
 * LAB_COMPLETED stays REQUESTED. requested_at and changed_at both come
 * from now() in separate transactions, so a real "after" is always a
 * strictly later timestamp; a tie stays REQUESTED (fails safe).
 *
 * This records what the system historically did, not whether results
 * exist. Review the orders it would close despite missing results
 * BEFORE running it:
 *
 *   SELECT lo.id, lo.visit_id, lo.requested_at, v.status AS visit_status
 *   FROM laboratory_orders lo
 *   JOIN visits v ON v.id = lo.visit_id
 *   WHERE lo.status = 'REQUESTED'
 *     AND EXISTS (SELECT 1 FROM queue_events qe
 *                 WHERE qe.visit_id = lo.visit_id
 *                   AND qe.to_status = 'LAB_COMPLETED'
 *                   AND qe.changed_at > lo.requested_at)
 *     AND EXISTS (SELECT 1 FROM laboratory_order_items li
 *                 WHERE li.order_id = lo.id
 *                   AND (li.result IS NULL OR btrim(li.result) = ''));
 *
 * Idempotent: only REQUESTED rows are considered.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    UPDATE laboratory_orders lo
    SET status = 'COMPLETED'
    WHERE lo.status = 'REQUESTED'
      AND EXISTS (
        SELECT 1 FROM queue_events qe
        WHERE qe.visit_id = lo.visit_id
          AND qe.to_status = 'LAB_COMPLETED'
          AND qe.changed_at > lo.requested_at
      )
  `);
}

/**
 * Nothing before this migration ever wrote COMPLETED, so reverting
 * restores the old always-REQUESTED state. Note this also reverts
 * orders completed by completeLabOrder() after the migration ran.
 */
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`UPDATE laboratory_orders SET status = 'REQUESTED' WHERE status = 'COMPLETED'`);
}
