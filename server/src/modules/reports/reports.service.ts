import { pool } from "../../config/db";
import {
  VisitsReportQuery,
  FinancialReportQuery,
  PurchasingReportQuery,
  PharmacyDispensingReportQuery,
} from "./reports.schema";

async function resolveDateRange(dateFrom: string | undefined, dateTo: string | undefined) {
  // to_char(..., 'YYYY-MM-DD') explicitly, rather than a bare ::date
  // cast — node-pg auto-parses a raw `date` column into a JS Date
  // object, which then serializes as a full ISO timestamp, not the
  // plain calendar-date string this API is meant to return.
  const result = await pool.query<{ date_from: string; date_to: string }>(
    `SELECT
       to_char(COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days'), 'YYYY-MM-DD') AS date_from,
       to_char(COALESCE($2::date, CURRENT_DATE), 'YYYY-MM-DD') AS date_to`,
    [dateFrom ?? null, dateTo ?? null]
  );
  return { dateFrom: result.rows[0].date_from, dateTo: result.rows[0].date_to };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface VisitsReport {
  dateFrom: string;
  dateTo: string;
  status: string | null;
  totalCount: number;
  byStatus: Array<{ status: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
}

export async function getVisitsReport(query: VisitsReportQuery): Promise<VisitsReport> {
  const range = await resolveDateRange(query.dateFrom, query.dateTo);

  const byStatusResult = await pool.query<{ status: string; count: string }>(
    `SELECT status, COUNT(*) AS count
     FROM visits
     WHERE created_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND created_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
       AND ($3::varchar IS NULL OR status = $3)
     GROUP BY status
     ORDER BY status`,
    [query.dateFrom ?? null, query.dateTo ?? null, query.status ?? null]
  );

  const byDateResult = await pool.query<{ date: string; count: string }>(
    `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date, COUNT(*) AS count
     FROM visits
     WHERE created_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND created_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
       AND ($3::varchar IS NULL OR status = $3)
     GROUP BY created_at::date
     ORDER BY date ASC`,
    [query.dateFrom ?? null, query.dateTo ?? null, query.status ?? null]
  );

  const byStatus = byStatusResult.rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  const totalCount = byStatus.reduce((sum, r) => sum + r.count, 0);

  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    status: query.status ?? null,
    totalCount,
    byStatus,
    byDate: byDateResult.rows.map((r) => ({ date: r.date, count: Number(r.count) })),
  };
}

export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  groupBy: "day" | "month";
  totalRevenue: number;
  paymentCount: number;
  byMethod: Array<{ method: string; total: number; count: number }>;
  byPeriod: Array<{ period: string; total: number; count: number }>;
  outstandingInvoices: Array<{
    invoiceId: string;
    visitId: string;
    patientCode: string;
    patientFullName: string;
    createdAt: string;
    subtotal: number;
    discount: number;
    total: number;
    amountPaid: number;
    balance: number;
  }>;
}

export async function getFinancialReport(query: FinancialReportQuery): Promise<FinancialReport> {
  const range = await resolveDateRange(query.dateFrom, query.dateTo);
  const dateParams = [query.dateFrom ?? null, query.dateTo ?? null];

  const totalsResult = await pool.query<{ total: string; count: string }>(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payments
     WHERE paid_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND paid_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'`,
    dateParams
  );

  const byMethodResult = await pool.query<{ method: string; total: string; count: string }>(
    `SELECT method, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payments
     WHERE paid_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND paid_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
     GROUP BY method
     ORDER BY method`,
    dateParams
  );

  const periodFormat = query.groupBy === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const byPeriodResult = await pool.query<{ period: string; total: string; count: string }>(
    `SELECT to_char(date_trunc($3, paid_at), $4) AS period,
            COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payments
     WHERE paid_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND paid_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
     GROUP BY date_trunc($3, paid_at)
     ORDER BY date_trunc($3, paid_at) ASC`,
    [...dateParams, query.groupBy, periodFormat]
  );

  const outstandingResult = await pool.query<{
    id: string;
    visit_id: string;
    patient_code: string;
    patient_full_name: string;
    created_at: string;
    subtotal: string;
    discount: string;
    total: string;
    paid: string;
    balance: string;
  }>(
    `WITH open_invoices AS (
       SELECT i.id, i.visit_id, i.discount, i.created_at
       FROM invoices i
       WHERE i.status = 'OPEN'
         AND i.created_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
         AND i.created_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
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
     SELECT oi.id, oi.visit_id, p.patient_code, p.full_name AS patient_full_name, oi.created_at,
            COALESCE(it.subtotal, 0) AS subtotal, oi.discount,
            COALESCE(it.subtotal, 0) - oi.discount AS total,
            COALESCE(pt.paid, 0) AS paid,
            COALESCE(it.subtotal, 0) - oi.discount - COALESCE(pt.paid, 0) AS balance
     FROM open_invoices oi
     JOIN visits v ON v.id = oi.visit_id
     JOIN patients p ON p.id = v.patient_id
     LEFT JOIN item_totals it ON it.invoice_id = oi.id
     LEFT JOIN payment_totals pt ON pt.invoice_id = oi.id
     WHERE COALESCE(it.subtotal, 0) - oi.discount - COALESCE(pt.paid, 0) > 0
     ORDER BY oi.created_at ASC`,
    dateParams
  );

  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    groupBy: query.groupBy,
    totalRevenue: round2(Number(totalsResult.rows[0].total)),
    paymentCount: Number(totalsResult.rows[0].count),
    byMethod: byMethodResult.rows.map((r) => ({
      method: r.method,
      total: round2(Number(r.total)),
      count: Number(r.count),
    })),
    byPeriod: byPeriodResult.rows.map((r) => ({
      period: r.period,
      total: round2(Number(r.total)),
      count: Number(r.count),
    })),
    outstandingInvoices: outstandingResult.rows.map((r) => ({
      invoiceId: r.id,
      visitId: r.visit_id,
      patientCode: r.patient_code,
      patientFullName: r.patient_full_name,
      createdAt: r.created_at,
      subtotal: round2(Number(r.subtotal)),
      discount: round2(Number(r.discount)),
      total: round2(Number(r.total)),
      amountPaid: round2(Number(r.paid)),
      balance: round2(Number(r.balance)),
    })),
  };
}

export interface PurchasingReport {
  dateFrom: string;
  dateTo: string;
  supplierId: string | null;
  status: string | null;
  totalPurchases: number;
  totalQuantity: number;
  totalCost: number;
  byStatus: Array<{ status: string; purchaseCount: number; totalQuantity: number; totalCost: number }>;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    purchaseCount: number;
    totalQuantity: number;
    totalCost: number;
  }>;
  byDate: Array<{ date: string; purchaseCount: number; totalQuantity: number; totalCost: number }>;
}

export async function getPurchasingReport(query: PurchasingReportQuery): Promise<PurchasingReport> {
  const range = await resolveDateRange(query.dateFrom, query.dateTo);
  const params = [query.dateFrom ?? null, query.dateTo ?? null, query.supplierId ?? null, query.status ?? null];
  const dateFilter = `p.purchase_date >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND p.purchase_date < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
       AND ($3::uuid IS NULL OR p.supplier_id = $3)
       AND ($4::varchar IS NULL OR p.status = $4)`;

  const byStatusResult = await pool.query<{
    status: string;
    purchase_count: string;
    total_quantity: string;
    total_cost: string;
  }>(
    `SELECT p.status, COUNT(DISTINCT p.id) AS purchase_count,
            COALESCE(SUM(pi.quantity), 0) AS total_quantity,
            COALESCE(SUM(pi.quantity * pi.unit_cost), 0) AS total_cost
     FROM purchases p
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
     WHERE ${dateFilter}
     GROUP BY p.status
     ORDER BY p.status`,
    params
  );

  const bySupplierResult = await pool.query<{
    supplier_id: string;
    supplier_name: string;
    purchase_count: string;
    total_quantity: string;
    total_cost: string;
  }>(
    `SELECT p.supplier_id, s.name AS supplier_name, COUNT(DISTINCT p.id) AS purchase_count,
            COALESCE(SUM(pi.quantity), 0) AS total_quantity,
            COALESCE(SUM(pi.quantity * pi.unit_cost), 0) AS total_cost
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
     WHERE ${dateFilter}
     GROUP BY p.supplier_id, s.name
     ORDER BY s.name`,
    params
  );

  const byDateResult = await pool.query<{
    date: string;
    purchase_count: string;
    total_quantity: string;
    total_cost: string;
  }>(
    `SELECT to_char(p.purchase_date, 'YYYY-MM-DD') AS date, COUNT(DISTINCT p.id) AS purchase_count,
            COALESCE(SUM(pi.quantity), 0) AS total_quantity,
            COALESCE(SUM(pi.quantity * pi.unit_cost), 0) AS total_cost
     FROM purchases p
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
     WHERE ${dateFilter}
     GROUP BY p.purchase_date
     ORDER BY p.purchase_date ASC`,
    params
  );

  const byStatus = byStatusResult.rows.map((r) => ({
    status: r.status,
    purchaseCount: Number(r.purchase_count),
    totalQuantity: Number(r.total_quantity),
    totalCost: round2(Number(r.total_cost)),
  }));

  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    supplierId: query.supplierId ?? null,
    status: query.status ?? null,
    totalPurchases: byStatus.reduce((sum, r) => sum + r.purchaseCount, 0),
    totalQuantity: byStatus.reduce((sum, r) => sum + r.totalQuantity, 0),
    totalCost: round2(byStatus.reduce((sum, r) => sum + r.totalCost, 0)),
    byStatus,
    bySupplier: bySupplierResult.rows.map((r) => ({
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      purchaseCount: Number(r.purchase_count),
      totalQuantity: Number(r.total_quantity),
      totalCost: round2(Number(r.total_cost)),
    })),
    byDate: byDateResult.rows.map((r) => ({
      date: r.date,
      purchaseCount: Number(r.purchase_count),
      totalQuantity: Number(r.total_quantity),
      totalCost: round2(Number(r.total_cost)),
    })),
  };
}

export interface PharmacyDispensingReport {
  dateFrom: string;
  dateTo: string;
  status: string | null;
  totalItemsDispensed: number;
  totalQuantityDispensed: number;
  byStatus: Array<{ status: string; itemCount: number; totalQuantityDispensed: number }>;
  byDate: Array<{ date: string; itemCount: number; totalQuantityDispensed: number }>;
}

/**
 * Filters strictly on dispensed_at - the only maintained dispensing
 * timestamp. Per the actual schema, dispensed_at is set exclusively
 * by the quantity-dispense path (never by mark-unavailable, never
 * set for PENDING items), so a status filter of PENDING or
 * UNAVAILABLE will correctly, honestly return zero rows for any
 * date-ranged query - the schema has no timestamp for "when an item
 * became unavailable / was left pending," so this report cannot and
 * does not fabricate one. Disclosed limitation, not a bug.
 */
export async function getPharmacyDispensingReport(
  query: PharmacyDispensingReportQuery
): Promise<PharmacyDispensingReport> {
  const range = await resolveDateRange(query.dateFrom, query.dateTo);
  const params = [query.dateFrom ?? null, query.dateTo ?? null, query.status ?? null];
  const filter = `dispensed_at IS NOT NULL
       AND dispensed_at >= COALESCE($1::date, CURRENT_DATE - INTERVAL '29 days')
       AND dispensed_at < COALESCE($2::date, CURRENT_DATE) + INTERVAL '1 day'
       AND ($3::varchar IS NULL OR status = $3)`;

  const byStatusResult = await pool.query<{ status: string; item_count: string; total_quantity: string }>(
    `SELECT status, COUNT(*) AS item_count, COALESCE(SUM(quantity_dispensed), 0) AS total_quantity
     FROM prescription_items
     WHERE ${filter}
     GROUP BY status
     ORDER BY status`,
    params
  );

  const byDateResult = await pool.query<{ date: string; item_count: string; total_quantity: string }>(
    `SELECT to_char(dispensed_at::date, 'YYYY-MM-DD') AS date, COUNT(*) AS item_count, COALESCE(SUM(quantity_dispensed), 0) AS total_quantity
     FROM prescription_items
     WHERE ${filter}
     GROUP BY dispensed_at::date
     ORDER BY date ASC`,
    params
  );

  const byStatus = byStatusResult.rows.map((r) => ({
    status: r.status,
    itemCount: Number(r.item_count),
    totalQuantityDispensed: Number(r.total_quantity),
  }));

  return {
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    status: query.status ?? null,
    totalItemsDispensed: byStatus.reduce((sum, r) => sum + r.itemCount, 0),
    totalQuantityDispensed: byStatus.reduce((sum, r) => sum + r.totalQuantityDispensed, 0),
    byStatus,
    byDate: byDateResult.rows.map((r) => ({
      date: r.date,
      itemCount: Number(r.item_count),
      totalQuantityDispensed: Number(r.total_quantity),
    })),
  };
}
