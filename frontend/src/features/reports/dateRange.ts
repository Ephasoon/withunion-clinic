import { isValidIsoDate, parseIsoDate } from "../../lib/dates";

/** A report date range as typed: "" (unset) or "YYYY-MM-DD". */
export interface DateRange {
  dateFrom: string;
  dateTo: string;
}

/** The backend's default window: dateFrom = today − 29 days, dateTo = today (30 inclusive days, docs §5.16). */
export const DEFAULT_RANGE_DAYS_BACK = 29;

/**
 * A "YYYY-MM-DD" date moved by whole days. Calendar arithmetic runs in
 * UTC on the date's own parts, so no timezone can shift the result.
 */
export function addDaysIso(iso: string, days: number): string {
  const parts = parseIsoDate(iso);
  if (!parts) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return utc.toISOString().slice(0, 10);
}

/** The backend's default range, computed from `today` ("YYYY-MM-DD"). */
export function defaultDateRange(today: string): DateRange {
  return { dateFrom: addDaysIso(today, -DEFAULT_RANGE_DAYS_BACK), dateTo: today };
}

export type DateRangeErrors = Partial<Record<keyof DateRange, string>>;

/**
 * Mirrors the reports' query schema: each date optional; if given, a real
 * "YYYY-MM-DD" date; and dateFrom must not be after dateTo — reported on
 * dateFrom, like the backend's refine.
 */
export function validateDateRange(range: DateRange): { ok: true } | { ok: false; errors: DateRangeErrors } {
  const errors: DateRangeErrors = {};
  const dateFrom = range.dateFrom.trim();
  const dateTo = range.dateTo.trim();
  if (dateFrom !== "" && !isValidIsoDate(dateFrom)) errors.dateFrom = "Enter a valid start date.";
  if (dateTo !== "" && !isValidIsoDate(dateTo)) errors.dateTo = "Enter a valid end date.";
  // Both are "YYYY-MM-DD", so string order is date order.
  if (!errors.dateFrom && !errors.dateTo && dateFrom !== "" && dateTo !== "" && dateFrom > dateTo) {
    errors.dateFrom = "The start date must not be after the end date.";
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * The last range the owner ran, shared by all four reports for the rest
 * of this page session. Deliberately kept in memory only — never in
 * localStorage or sessionStorage — so it resets on reload.
 */
let sessionRange: DateRange | null = null;

export function getSessionRange(today: string): DateRange {
  return sessionRange ?? defaultDateRange(today);
}

export function setSessionRange(range: DateRange): void {
  sessionRange = { dateFrom: range.dateFrom.trim(), dateTo: range.dateTo.trim() };
}

/** For tests. */
export function resetSessionRange(): void {
  sessionRange = null;
}
