/** docs/api-inventory.md §5.16. Every report is `{ data: { report } }`; dates are plain "YYYY-MM-DD" strings. */

export const REPORT_TYPES = ["visits", "financial", "purchasing", "pharmacy-dispensing"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const PURCHASE_STATUSES = ["PENDING", "RECEIVED"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const DISPENSING_STATUSES = ["PENDING", "PARTIALLY_DISPENSED", "DISPENSED", "UNAVAILABLE"] as const;
export type DispensingStatus = (typeof DISPENSING_STATUSES)[number];

export type GroupBy = "day" | "month";

export interface VisitsReport {
  dateFrom: string;
  dateTo: string;
  status: string | null;
  totalCount: number;
  byStatus: Array<{ status: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
}

export interface FinancialReport {
  dateFrom: string;
  dateTo: string;
  groupBy: GroupBy;
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

export interface PharmacyDispensingReport {
  dateFrom: string;
  dateTo: string;
  status: string | null;
  totalItemsDispensed: number;
  totalQuantityDispensed: number;
  byStatus: Array<{ status: string; itemCount: number; totalQuantityDispensed: number }>;
  byDate: Array<{ date: string; itemCount: number; totalQuantityDispensed: number }>;
}
