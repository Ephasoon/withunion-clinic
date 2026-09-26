import { pool } from "../../config/db";
import { env } from "../../config/env";
import { AppError } from "../../utils/appError";

export interface ReceiptItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ReceiptPayment {
  amount: number;
  method: string;
  paidAt: string;
  recordedByName: string;
}

export interface Receipt {
  receiptNumber: string;
  clinic: { name: string; address: string; phone: string };
  invoiceId: string;
  invoiceStatus: string;
  visitId: string;
  patientCode: string;
  patientFullName: string;
  cashierName: string;
  createdAt: string;
  items: ReceiptItem[];
  payments: ReceiptPayment[];
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balance: number;
}

interface InvoiceRow {
  id: string;
  status: string;
  discount: string;
  created_at: string;
  visit_id: string;
  patient_code: string;
  patient_full_name: string;
  cashier_name: string;
}

interface ItemRow {
  description: string;
  quantity: number;
  unit_price: string;
}

interface PaymentRow {
  amount: string;
  method: string;
  paid_at: string;
  recorded_by_name: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function receiptNumberFor(invoiceId: string): string {
  return `RCPT-${invoiceId.slice(0, 8).toUpperCase()}`;
}

export async function getReceipt(invoiceId: string): Promise<Receipt> {
  const invoiceResult = await pool.query<InvoiceRow>(
    `SELECT i.id, i.status, i.discount, i.created_at, i.visit_id,
            p.patient_code, p.full_name AS patient_full_name, u.full_name AS cashier_name
     FROM invoices i
     JOIN visits v ON v.id = i.visit_id
     JOIN patients p ON p.id = v.patient_id
     JOIN users u ON u.id = i.cashier_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  const invoiceRow = invoiceResult.rows[0];
  if (!invoiceRow) {
    throw new AppError(404, "NOT_FOUND", "Invoice not found");
  }

  // Approved V1 rule: receipts are only available for fully PAID
  // invoices. OPEN invoices — including partially paid ones — are
  // rejected here, before any items/payments are even read. Since
  // Billing's completion step only ever marks an invoice PAID after
  // recomputing balance === 0 under a row lock, a PAID invoice can
  // never legitimately have an outstanding balance — the old
  // "at least one payment" gate is no longer needed as a result.
  if (invoiceRow.status !== "PAID") {
    throw new AppError(
      409,
      "RECEIPT_NOT_AVAILABLE_UNTIL_PAID",
      `Receipts are only available once the invoice is fully paid (currently ${invoiceRow.status})`
    );
  }

  const itemsResult = await pool.query<ItemRow>(
    `SELECT description, quantity, unit_price FROM invoice_items WHERE invoice_id = $1 ORDER BY description ASC`,
    [invoiceId]
  );
  const paymentsResult = await pool.query<PaymentRow>(
    `SELECT pay.amount, pay.method, pay.paid_at, u.full_name AS recorded_by_name
     FROM payments pay
     JOIN users u ON u.id = pay.recorded_by
     WHERE pay.invoice_id = $1
     ORDER BY pay.paid_at ASC`,
    [invoiceId]
  );

  const items: ReceiptItem[] = itemsResult.rows.map((row) => {
    const quantity = row.quantity;
    const unitPrice = Number(row.unit_price);
    return { description: row.description, quantity, unitPrice, lineTotal: round2(quantity * unitPrice) };
  });
  const subtotal = round2(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const discount = Number(invoiceRow.discount);
  const total = round2(subtotal - discount);

  const payments: ReceiptPayment[] = paymentsResult.rows.map((row) => ({
    amount: Number(row.amount),
    method: row.method,
    paidAt: row.paid_at,
    recordedByName: row.recorded_by_name,
  }));
  const amountPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  const balance = round2(total - amountPaid);

  return {
    receiptNumber: receiptNumberFor(invoiceRow.id),
    clinic: { name: env.CLINIC_NAME, address: env.CLINIC_ADDRESS, phone: env.CLINIC_PHONE },
    invoiceId: invoiceRow.id,
    invoiceStatus: invoiceRow.status,
    visitId: invoiceRow.visit_id,
    patientCode: invoiceRow.patient_code,
    patientFullName: invoiceRow.patient_full_name,
    cashierName: invoiceRow.cashier_name,
    createdAt: invoiceRow.created_at,
    items,
    payments,
    subtotal,
    discount,
    total,
    amountPaid,
    balance,
  };
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (c) => map[c]);
}

export function renderReceiptHtml(receipt: Receipt): string {
  const itemRows = receipt.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.description)}</td>
        <td style="text-align:right">${item.quantity}</td>
        <td style="text-align:right">${item.unitPrice.toFixed(2)}</td>
        <td style="text-align:right">${item.lineTotal.toFixed(2)}</td>
      </tr>`
    )
    .join("");
  const paymentRows = receipt.payments
    .map(
      (p) => `<tr>
        <td>${new Date(p.paidAt).toLocaleString()}</td>
        <td>${escapeHtml(p.method)}</td>
        <td style="text-align:right">${p.amount.toFixed(2)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(receipt.receiptNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { width: 76mm; font-family: monospace; font-size: 11px; margin: 0; padding: 4px; }
  h1 { font-size: 13px; text-align: center; margin: 2px 0; }
  .center { text-align: center; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  td { padding: 1px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <h1>${escapeHtml(receipt.clinic.name)}</h1>
  <div class="center">${escapeHtml(receipt.clinic.address)}</div>
  <div class="center">${escapeHtml(receipt.clinic.phone)}</div>
  <hr />
  <div>Receipt: ${escapeHtml(receipt.receiptNumber)}</div>
  <div>Date: ${new Date(receipt.createdAt).toLocaleString()}</div>
  <div>Patient: ${escapeHtml(receipt.patientFullName)} (${escapeHtml(receipt.patientCode)})</div>
  <div>Cashier: ${escapeHtml(receipt.cashierName)}</div>
  <hr />
  <table>
    <tr><td>Item</td><td style="text-align:right">Qty</td><td style="text-align:right">Price</td><td style="text-align:right">Total</td></tr>
    ${itemRows || '<tr><td colspan="4" class="center">No items</td></tr>'}
  </table>
  <hr />
  <table>
    <tr><td>Subtotal</td><td style="text-align:right">${receipt.subtotal.toFixed(2)}</td></tr>
    <tr><td>Discount</td><td style="text-align:right">${receipt.discount.toFixed(2)}</td></tr>
    <tr><td><b>Total</b></td><td style="text-align:right"><b>${receipt.total.toFixed(2)}</b></td></tr>
    <tr><td>Amount Paid</td><td style="text-align:right">${receipt.amountPaid.toFixed(2)}</td></tr>
    <tr><td>Balance</td><td style="text-align:right">${receipt.balance.toFixed(2)}</td></tr>
  </table>
  <hr />
  <div>Payments</div>
  <table>${paymentRows}</table>
  <hr />
  <div class="center">Thank you</div>
  <script class="no-print">window.print();</script>
</body>
</html>`;
}
