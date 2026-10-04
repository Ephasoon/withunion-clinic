import type { VisitStatus } from "../visits/types";

/** docs/api-inventory.md §4 InvoiceDetail and §5.10. Money values are JSON numbers rounded to 2 dp. */

export const PAYMENT_METHODS = ["cash", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export interface InvoiceDetail {
  id: string;
  visitId: string;
  visitStatus: VisitStatus;
  patientCode: string;
  patientFullName: string;
  cashierId: string;
  /** Always 0 — there is no way to set a discount (docs §5.10). */
  discount: number;
  status: "OPEN" | "PAID";
  createdAt: string;
  /** description ASC */
  items: Array<{ id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  /** paidAt ASC */
  payments: Array<{ id: string; amount: number; method: PaymentMethod; recordedBy: string; paidAt: string }>;
  subtotal: number;
  total: number;
  amountPaid: number;
  balance: number;
}

/** GET /billing/invoices work item. */
export interface BillingWorkItem {
  visitId: string;
  patientCode: string;
  patientFullName: string;
  invoice: InvoiceDetail | null;
}

export interface InvoiceItemBody {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PaymentBody {
  amount: number;
  method: PaymentMethod;
}

/** docs §4 ChargeNameLink and §5.18 — a saved "this name is charged as that price-list item". */
export interface ChargeNameLink {
  id: string;
  /** The normalized name (see normalizeChargeName). */
  nameKey: string;
  priceListItemId: string;
  createdBy: string;
  createdAt: string;
}

/** Body of PUT /charge-links. Strict: only these keys. */
export interface SaveChargeLinkBody {
  name: string;
  priceListItemId: string;
}
