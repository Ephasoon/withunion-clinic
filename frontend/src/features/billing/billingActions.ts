import { ROLES } from "../../rbac/roles";
import type { VisitStatus } from "../visits/types";
import { isZeroBalance } from "./money";
import type { InvoiceDetail } from "./types";

export interface BillingActions {
  /** POST /billing/visits/:visitId/invoice — reception, visit WAITING_FOR_BILLING, no invoice yet. */
  canCreateInvoice: boolean;
  /** POST /billing/invoices/:id/items — reception, invoice OPEN. */
  canAddItems: boolean;
  /** POST /billing/invoices/:id/payments — reception, invoice OPEN, something left to pay. */
  canRecordPayment: boolean;
  /** POST /billing/invoices/:id/complete — reception, invoice OPEN, balance exactly 0, visit WAITING_FOR_BILLING. */
  canComplete: boolean;
  /** GET /receipts/invoices/:id (+ print) — reception or owner, invoice PAID. */
  canViewReceipt: boolean;
}

const NONE: BillingActions = {
  canCreateInvoice: false,
  canAddItems: false,
  canRecordPayment: false,
  canComplete: false,
  canViewReceipt: false,
};

/**
 * What a user may do on a visit's billing page (docs §5.10–5.11).
 * Every write is reception-only; the owner may view the invoice and its
 * receipt. Writes are also offered only while the visit is
 * WAITING_FOR_BILLING: if the visit was cancelled with an invoice still
 * OPEN, the backend would still take items and payments, but completing
 * is impossible, so the page shows it read-only instead of taking money.
 */
export function allowedBillingActions(
  role: string,
  visitStatus: VisitStatus,
  invoice: Pick<InvoiceDetail, "status" | "balance"> | null
): BillingActions {
  const isReception = role === ROLES.RECEPTION;
  const canView = isReception || role === ROLES.OWNER;
  const billable = visitStatus === "WAITING_FOR_BILLING";

  if (invoice === null) return { ...NONE, canCreateInvoice: isReception && billable };
  if (invoice.status === "PAID") return { ...NONE, canViewReceipt: canView };

  const open = isReception && billable;
  return {
    ...NONE,
    canAddItems: open,
    canRecordPayment: open && !isZeroBalance(invoice.balance),
    canComplete: open && isZeroBalance(invoice.balance),
  };
}
