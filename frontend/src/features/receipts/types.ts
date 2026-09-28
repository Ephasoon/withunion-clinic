import type { PaymentMethod } from "../billing/types";

/** docs/api-inventory.md §4 Receipt. Money values are numbers, 2 dp. */
export interface Receipt {
  /** "RCPT-" + first 8 hex chars of the invoice id, uppercased. */
  receiptNumber: string;
  clinic: { name: string; address: string; phone: string };
  invoiceId: string;
  invoiceStatus: "PAID";
  visitId: string;
  patientCode: string;
  patientFullName: string;
  cashierName: string;
  createdAt: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number }>;
  payments: Array<{ amount: number; method: PaymentMethod; paidAt: string; recordedByName: string }>;
  subtotal: number;
  discount: number;
  total: number;
  amountPaid: number;
  balance: number;
}
