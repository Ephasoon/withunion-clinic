import { pool } from "../../config/db";
import { ALL_ROLES } from "../roles/roles";
import { TERMINAL_STATUSES, VISIT_STATUSES } from "../visits/visits.schema";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DashboardSnapshot {
  generatedAt: string;
  patients: { registeredToday: number };
  visits: {
    today: number;
    completedToday: number;
    cancelledToday: number;
    byStatus: Record<string, number>;
  };
  billing: {
    revenueToday: number;
    paymentsToday: number;
    openInvoiceCount: number;
    totalOutstandingBalance: number;
  };
  inventory: { totalItems: number; outOfStockCount: number };
  staff: { activeByRole: Record<string, number>; totalActive: number };
}

/**
 * Every "today" boundary below uses Postgres's own CURRENT_DATE
 * consistently, so all counts share the same server-side notion of
 * "today" rather than mixing it with application-server clock time.
 *
 * Every count/amount defaults to 0 via COALESCE — this endpoint never
 * returns null for a numeric field, even on a freshly-seeded system
 * with no data yet.
 *
 * totalOutstandingBalance is one aggregate query over OPEN invoices
 * only (not a loop over per-invoice detail calls — avoiding the N+1
 * pattern), deriving subtotal/discount/paid exactly as Billing itself
 * defines them, without storing or duplicating that derived value
 * anywhere.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const [
    patientsResult,
    visitsTodayResult,
    visitsCompletedResult,
    visitsCancelledResult,
    visitsByStatusResult,
    revenueResult,
    paymentsCountResult,
    openInvoiceCountResult,
    outstandingResult,
    inventoryTotalResult,
    inventoryOutOfStockResult,
    staffByRoleResult,
    staffTotalResult,
  ] = await Promise.all([
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM patients WHERE created_at >= CURRENT_DATE`),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM visits WHERE created_at >= CURRENT_DATE`),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM visits WHERE status = 'COMPLETED' AND completed_at >= CURRENT_DATE`
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM visits WHERE status = 'CANCELLED' AND cancelled_at >= CURRENT_DATE`
    ),
    pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) FROM visits WHERE status = ANY($1) GROUP BY status`,
      [VISIT_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s))]
    ),
    pool.query<{ total: string | null }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE paid_at >= CURRENT_DATE`),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM payments WHERE paid_at >= CURRENT_DATE`),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM invoices WHERE status = 'OPEN'`),
    pool.query<{ total: string | null }>(`
      WITH open_invoices AS (
        SELECT id, discount FROM invoices WHERE status = 'OPEN'
      ),
      item_totals AS (
        SELECT invoice_id, SUM(quantity * unit_price) AS subtotal
        FROM invoice_items
        WHERE invoice_id IN (SELECT id FROM open_invoices)
        GROUP BY invoice_id
      ),
      payment_totals AS (
        SELECT invoice_id, SUM(amount) AS paid
        FROM payments
        WHERE invoice_id IN (SELECT id FROM open_invoices)
        GROUP BY invoice_id
      )
      SELECT COALESCE(SUM(
        COALESCE(it.subtotal, 0) - oi.discount - COALESCE(pt.paid, 0)
      ), 0) AS total
      FROM open_invoices oi
      LEFT JOIN item_totals it ON it.invoice_id = oi.id
      LEFT JOIN payment_totals pt ON pt.invoice_id = oi.id
    `),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM pharmacy_inventory_items`),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM pharmacy_inventory_items WHERE quantity_on_hand = 0`),
    pool.query<{ name: string; count: string }>(
      `SELECT r.name, COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = true GROUP BY r.name`
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM users WHERE is_active = true`),
  ]);

  // Every non-terminal status appears in the response even when its
  // count is 0, per the approved response shape — not just the
  // statuses that happen to have a visit sitting in them right now.
  const byStatus: Record<string, number> = {};
  for (const status of VISIT_STATUSES) {
    if (!TERMINAL_STATUSES.includes(status)) {
      byStatus[status] = 0;
    }
  }
  for (const row of visitsByStatusResult.rows) {
    byStatus[row.status] = Number(row.count);
  }

  // Same "every role present, even at 0" treatment for staff counts.
  const activeByRole: Record<string, number> = {};
  for (const role of ALL_ROLES) {
    activeByRole[role] = 0;
  }
  for (const row of staffByRoleResult.rows) {
    activeByRole[row.name] = Number(row.count);
  }

  return {
    generatedAt: new Date().toISOString(),
    patients: { registeredToday: Number(patientsResult.rows[0].count) },
    visits: {
      today: Number(visitsTodayResult.rows[0].count),
      completedToday: Number(visitsCompletedResult.rows[0].count),
      cancelledToday: Number(visitsCancelledResult.rows[0].count),
      byStatus,
    },
    billing: {
      revenueToday: round2(Number(revenueResult.rows[0].total ?? 0)),
      paymentsToday: Number(paymentsCountResult.rows[0].count),
      openInvoiceCount: Number(openInvoiceCountResult.rows[0].count),
      totalOutstandingBalance: round2(Number(outstandingResult.rows[0].total ?? 0)),
    },
    inventory: {
      totalItems: Number(inventoryTotalResult.rows[0].count),
      outOfStockCount: Number(inventoryOutOfStockResult.rows[0].count),
    },
    staff: {
      activeByRole,
      totalActive: Number(staffTotalResult.rows[0].count),
    },
  };
}
