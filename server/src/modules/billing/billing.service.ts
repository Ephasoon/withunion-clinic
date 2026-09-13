import { Pool, PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { getVisitById, transitionVisitWithClient } from "../visits/visits.service";
import { AddInvoiceItemsInput, RecordPaymentInput } from "./billing.schema";

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Payment {
  id: string;
  amount: number;
  method: string;
  recordedBy: string;
  paidAt: string;
}

export interface InvoiceDetail {
  id: string;
  visitId: string;
  visitStatus: string;
  patientCode: string;
  patientFullName: string;
  cashierId: string;
  discount: number;
  status: string;
  createdAt: string;
  items: InvoiceItem[];
  payments: Payment[];
  subtotal: number;
  total: number;
  amountPaid: number;
  balance: number;
}

interface InvoiceRow {
  id: string;
  visit_id: string;
  visit_status: string;
  patient_code: string;
  patient_full_name: string;
  cashier_id: string;
  discount: string;
  status: string;
  created_at: string;
}

interface ItemRow {
  id: string;
  description: string;
  quantity: number;
  unit_price: string;
}

interface PaymentRow {
  id: string;
  amount: string;
  method: string;
  recorded_by: string;
  paid_at: string;
}

/**
 * Either the shared pool or a transactional client — both expose the
 * same .query() shape, so every read helper below can run either as
 * an ordinary (non-locking) read via `pool`, or as part of a caller's
 * own transaction via a supplied `client`, without duplicating SQL.
 */
type DbExecutor = Pool | PoolClient;

const INVOICE_SELECT = `
  SELECT i.id, i.visit_id, v.status AS visit_status, p.patient_code, p.full_name AS patient_full_name,
         i.cashier_id, i.discount, i.status, i.created_at
  FROM invoices i
  JOIN visits v ON v.id = i.visit_id
  JOIN patients p ON p.id = v.patient_id
`;

/** Rounds a monetary value to 2 decimal places, guarding against
 * floating-point dust (e.g. 599.9999999999 instead of exactly 600)
 * from repeated Number() conversions of numeric(10,2) values —
 * otherwise a legitimate exact final payment or a zero balance could
 * be incorrectly rejected/blocked by a strict equality check. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchInvoiceRow(executor: DbExecutor, invoiceId: string): Promise<InvoiceRow | null> {
  const result = await executor.query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1`, [invoiceId]);
  return result.rows[0] ?? null;
}

/**
 * Locks the invoice row (FOR UPDATE OF i, scoped to just the invoices
 * table alias — the joined visits/patients rows are not locked) and
 * returns the freshest possible read. Used by both addInvoiceItems()
 * and completeBilling() so the two contend for the same row lock and
 * are therefore serialized against each other: whichever transaction
 * acquires the lock first fully completes (commits or rolls back)
 * before the other proceeds, and the second one always re-reads the
 * now-current state rather than acting on stale data.
 */
async function lockInvoiceRow(client: PoolClient, invoiceId: string): Promise<InvoiceRow> {
  const result = await client.query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [invoiceId]);
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Invoice not found");
  }
  return row;
}

async function fetchItemsAndPayments(
  executor: DbExecutor,
  invoiceId: string
): Promise<{ items: ItemRow[]; payments: PaymentRow[] }> {
  const itemsResult = await executor.query<ItemRow>(
    `SELECT id, description, quantity, unit_price FROM invoice_items WHERE invoice_id = $1 ORDER BY description ASC`,
    [invoiceId]
  );
  const paymentsResult = await executor.query<PaymentRow>(
    `SELECT id, amount, method, recorded_by, paid_at FROM payments WHERE invoice_id = $1 ORDER BY paid_at ASC`,
    [invoiceId]
  );
  return { items: itemsResult.rows, payments: paymentsResult.rows };
}

/** Pure computation — no queries. Same math as before the refactor. */
function computeDetail(row: InvoiceRow, itemRows: ItemRow[], paymentRows: PaymentRow[]): InvoiceDetail {
  const items: InvoiceItem[] = itemRows.map((r) => ({
    id: r.id,
    description: r.description,
    quantity: r.quantity,
    unitPrice: Number(r.unit_price),
    lineTotal: round2(r.quantity * Number(r.unit_price)),
  }));

  const payments: Payment[] = paymentRows.map((r) => ({
    id: r.id,
    amount: Number(r.amount),
    method: r.method,
    recordedBy: r.recorded_by,
    paidAt: r.paid_at,
  }));

  const subtotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const discount = Number(row.discount);
  const total = round2(subtotal - discount);
  const amountPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const balance = round2(total - amountPaid);

  return {
    id: row.id,
    visitId: row.visit_id,
    visitStatus: row.visit_status,
    patientCode: row.patient_code,
    patientFullName: row.patient_full_name,
    cashierId: row.cashier_id,
    discount,
    status: row.status,
    createdAt: row.created_at,
    items,
    payments,
    subtotal,
    total,
    amountPaid,
    balance,
  };
}

export async function getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  const row = await fetchInvoiceRow(pool, invoiceId);
  if (!row) return null;
  const { items, payments } = await fetchItemsAndPayments(pool, invoiceId);
  return computeDetail(row, items, payments);
}

export async function getInvoiceByVisitId(visitId: string): Promise<InvoiceDetail | null> {
  const result = await pool.query<InvoiceRow>(`${INVOICE_SELECT} WHERE i.visit_id = $1`, [visitId]);
  if (!result.rows[0]) return null;
  const { items, payments } = await fetchItemsAndPayments(pool, result.rows[0].id);
  return computeDetail(result.rows[0], items, payments);
}

export async function listBillingWork(): Promise<
  Array<{ visitId: string; patientCode: string; patientFullName: string; invoice: InvoiceDetail | null }>
> {
  const result = await pool.query<{
    id: string;
    patient_code: string;
    full_name: string;
  }>(
    `SELECT v.id, p.patient_code, p.full_name
     FROM visits v
     JOIN patients p ON p.id = v.patient_id
     WHERE v.status = 'WAITING_FOR_BILLING'
     ORDER BY v.created_at ASC`
  );

  return Promise.all(
    result.rows.map(async (row) => ({
      visitId: row.id,
      patientCode: row.patient_code,
      patientFullName: row.full_name,
      invoice: await getInvoiceByVisitId(row.id),
    }))
  );
}

export async function createInvoice(visitId: string, cashierId: string): Promise<InvoiceDetail> {
  const visit = await getVisitById(visitId);
  if (!visit) {
    throw new AppError(404, "NOT_FOUND", "Visit not found");
  }
  if (visit.status !== "WAITING_FOR_BILLING") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `An invoice can only be created while the visit is WAITING_FOR_BILLING (currently ${visit.status})`
    );
  }

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO invoices (visit_id, cashier_id) VALUES ($1, $2) RETURNING id`,
      [visitId, cashierId]
    );
    return (await getInvoiceDetail(result.rows[0].id))!;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      throw new AppError(409, "INVOICE_ALREADY_EXISTS", "This visit already has an invoice");
    }
    throw err;
  }
}

/**
 * Locks the invoice row first (contending for the same lock as
 * completeBilling()), re-checks status against that locked/fresh
 * read, and only then inserts items — all inside one transaction.
 * This is what closes the race where an item could otherwise be
 * added concurrently with a completion that read a stale
 * (already-zero) balance.
 */
export async function addInvoiceItems(invoiceId: string, input: AddInvoiceItemsInput): Promise<InvoiceDetail> {
  await withTransaction(async (client: PoolClient) => {
    const invoiceRow = await lockInvoiceRow(client, invoiceId);
    if (invoiceRow.status !== "OPEN") {
      throw new AppError(409, "INVOICE_NOT_OPEN", `Invoice is already ${invoiceRow.status}`);
    }

    for (const entry of input.items) {
      await client.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
        [invoiceId, entry.description, entry.quantity, entry.unitPrice]
      );
    }
  });

  return (await getInvoiceDetail(invoiceId))!;
}

async function requireOpenInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const invoice = await getInvoiceDetail(invoiceId);
  if (!invoice) {
    throw new AppError(404, "NOT_FOUND", "Invoice not found");
  }
  if (invoice.status !== "OPEN") {
    throw new AppError(409, "INVOICE_NOT_OPEN", `Invoice is already ${invoice.status}`);
  }
  return invoice;
}

export async function recordPayment(
  invoiceId: string,
  recordedBy: string,
  input: RecordPaymentInput
): Promise<InvoiceDetail> {
  const invoice = await requireOpenInvoice(invoiceId);

  if (round2(input.amount) > invoice.balance) {
    throw new AppError(
      400,
      "OVERPAYMENT",
      `Payment of ${input.amount} exceeds the remaining balance of ${invoice.balance}`
    );
  }

  await pool.query(
    `INSERT INTO payments (invoice_id, amount, method, recorded_by) VALUES ($1, $2, $3, $4)`,
    [invoiceId, input.amount, input.method, recordedBy]
  );

  return (await getInvoiceDetail(invoiceId))!;
}

/**
 * Marks the invoice PAID and transitions the visit to COMPLETED in
 * ONE PostgreSQL transaction. All authoritative validation now
 * happens INSIDE the transaction, after locking the invoice row:
 *   1. lock the invoice row (FOR UPDATE OF i) — the same lock
 *      addInvoiceItems() contends for, so the two are serialized;
 *   2. re-fetch items/payments via the same client and recompute
 *      subtotal/total/amountPaid/balance fresh, not from any
 *      pre-transaction read;
 *   3. re-verify invoice status is OPEN;
 *   4. re-verify the visit is still WAITING_FOR_BILLING;
 *   5. reject (same business error/code as before) if balance != 0;
 *   6. mark the invoice PAID;
 *   7. call transitionVisitWithClient() on this same client, so the
 *      invoice UPDATE, the visit UPDATE, and the queue_events INSERT
 *      all commit or roll back together.
 * No compensating write exists or is needed: any throw inside this
 * callback rolls back everything via withTransaction's own
 * catch -> ROLLBACK.
 */
export async function completeBilling(
  invoiceId: string,
  cashierId: string
): Promise<{ invoice: InvoiceDetail; visitStatus: string }> {
  const visitStatus = await withTransaction(async (client: PoolClient) => {
    const invoiceRow = await lockInvoiceRow(client, invoiceId);

    if (invoiceRow.status !== "OPEN") {
      throw new AppError(409, "INVOICE_NOT_OPEN", `Invoice is already ${invoiceRow.status}`);
    }
    if (invoiceRow.visit_status !== "WAITING_FOR_BILLING") {
      throw new AppError(
        409,
        "INVALID_VISIT_STATE",
        `Billing can only be completed while the visit is WAITING_FOR_BILLING (currently ${invoiceRow.visit_status})`
      );
    }

    const { items, payments } = await fetchItemsAndPayments(client, invoiceId);
    const detail = computeDetail(invoiceRow, items, payments);
    if (detail.balance !== 0) {
      throw new AppError(409, "INVOICE_NOT_PAID", `Cannot complete: remaining balance is ${detail.balance}`);
    }

    await client.query(`UPDATE invoices SET status = 'PAID' WHERE id = $1`, [invoiceId]);
    const visit = await transitionVisitWithClient(
      client,
      invoiceRow.visit_id,
      "reception",
      "COMPLETED",
      undefined,
      cashierId
    );
    return visit.status;
  });

  return { invoice: (await getInvoiceDetail(invoiceId))!, visitStatus };
}
