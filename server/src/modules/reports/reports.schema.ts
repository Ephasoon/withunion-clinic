import { z } from "zod";

const VISIT_STATUSES = [
  "REGISTERED",
  "WAITING_FOR_NURSE",
  "WITH_NURSE",
  "WAITING_FOR_DOCTOR",
  "WITH_DOCTOR",
  "WAITING_FOR_LAB",
  "AT_LAB",
  "LAB_COMPLETED",
  "WAITING_FOR_PHARMACY",
  "AT_PHARMACY",
  "WAITING_FOR_BILLING",
  "COMPLETED",
  "CANCELLED",
] as const;

const PURCHASE_STATUSES = ["PENDING", "RECEIVED"] as const;

const PRESCRIPTION_ITEM_STATUSES = ["PENDING", "PARTIALLY_DISPENSED", "DISPENSED", "UNAVAILABLE"] as const;

function withDateRangeValidation<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({
      dateFrom: z.string().date("dateFrom must be an ISO date (YYYY-MM-DD)").optional(),
      dateTo: z.string().date("dateTo must be an ISO date (YYYY-MM-DD)").optional(),
      ...shape,
    })
    .strict()
    .refine((data) => !data.dateFrom || !data.dateTo || data.dateFrom <= data.dateTo, {
      message: "dateFrom must not be after dateTo",
      path: ["dateFrom"],
    });
}

export const VisitsReportQuerySchema = withDateRangeValidation({
  status: z.enum(VISIT_STATUSES).optional(),
});
export type VisitsReportQuery = z.infer<typeof VisitsReportQuerySchema>;

export const FinancialReportQuerySchema = withDateRangeValidation({
  groupBy: z.enum(["day", "month"]).default("day"),
});
export type FinancialReportQuery = z.infer<typeof FinancialReportQuerySchema>;

export const PurchasingReportQuerySchema = withDateRangeValidation({
  supplierId: z.string().uuid("supplierId must be a valid uuid").optional(),
  status: z.enum(PURCHASE_STATUSES).optional(),
});
export type PurchasingReportQuery = z.infer<typeof PurchasingReportQuerySchema>;

export const PharmacyDispensingReportQuerySchema = withDateRangeValidation({
  status: z.enum(PRESCRIPTION_ITEM_STATUSES).optional(),
});
export type PharmacyDispensingReportQuery = z.infer<typeof PharmacyDispensingReportQuerySchema>;
