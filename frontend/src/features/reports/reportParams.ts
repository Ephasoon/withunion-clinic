import type { QueryParams } from "../../api";
import type { VisitStatus } from "../visits/types";
import type { DateRange } from "./dateRange";
import type { DispensingStatus, GroupBy, PurchaseStatus } from "./types";

/**
 * Query-param builders for the four reports. Like every other query in
 * this app, unset filters are left out entirely — the key is absent, not
 * sent as "" — so the backend applies its own defaults. (apiUrl() would
 * also drop undefined values, but the builders never produce them.)
 */

function withRange(range: DateRange): QueryParams {
  const params: QueryParams = {};
  const dateFrom = range.dateFrom.trim();
  const dateTo = range.dateTo.trim();
  if (dateFrom !== "") params.dateFrom = dateFrom;
  if (dateTo !== "") params.dateTo = dateTo;
  return params;
}

export function visitsReportParams(range: DateRange, filters: { status: VisitStatus | "" }): QueryParams {
  const params = withRange(range);
  if (filters.status !== "") params.status = filters.status;
  return params;
}

/** groupBy is always sent: the backend defaults it to "day" anyway, and sending it keeps the result self-describing. */
export function financialReportParams(range: DateRange, filters: { groupBy: GroupBy }): QueryParams {
  return { ...withRange(range), groupBy: filters.groupBy };
}

export function purchasingReportParams(
  range: DateRange,
  filters: { supplierId: string; status: PurchaseStatus | "" }
): QueryParams {
  const params = withRange(range);
  const supplierId = filters.supplierId.trim();
  if (supplierId !== "") params.supplierId = supplierId;
  if (filters.status !== "") params.status = filters.status;
  return params;
}

export function pharmacyDispensingReportParams(range: DateRange, filters: { status: DispensingStatus | "" }): QueryParams {
  const params = withRange(range);
  if (filters.status !== "") params.status = filters.status;
  return params;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The purchasing report's free-text supplier id (there is no supplier
 * picker yet): blank, or a UUID like the backend requires.
 */
export function validateSupplierId(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || UUID.test(value)) return null;
  return "Enter a supplier id (a UUID), or leave it blank for all suppliers.";
}

/**
 * The dispensing report counts only items with dispensed_at set, so these
 * status filters can never match anything (docs §5.16).
 */
export const ALWAYS_EMPTY_DISPENSING_STATUSES: readonly DispensingStatus[] = ["PENDING", "UNAVAILABLE"];
