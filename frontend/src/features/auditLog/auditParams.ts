import type { QueryParams } from "../../api";
import { isValidIsoDate, parseIsoDate } from "../../lib/dates";

/** Limits from AuditLogQuerySchema (docs §5.12). */
export const AUDIT_TEXT_MAX = 64;
export const AUDIT_PAGE_SIZES = [20, 50, 100] as const;
export const AUDIT_OFFSET_MAX = 1_000_000;

export interface AuditFilters {
  entity: string;
  entityId: string;
  /** "" or a user's id (chosen from the users list). */
  userId: string;
  action: string;
  /** "" or "YYYY-MM-DD" — the owner's LOCAL calendar day. */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { entity: "", entityId: "", userId: "", action: "", dateFrom: "", dateTo: "" };

/**
 * The first millisecond of a local calendar day as an ISO timestamp.
 * The backend reads a bare "YYYY-MM-DD" as UTC midnight; sending the
 * local day's real start keeps the filter on the owner's own days.
 */
export function localDayStartIso(day: string): string {
  const p = parseIsoDate(day);
  if (!p) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
  return new Date(p.year, p.month - 1, p.day, 0, 0, 0, 0).toISOString();
}

/**
 * The last millisecond of a local calendar day. The backend compares
 * `created_at <= dateTo`, so a bare "2026-09-28" (UTC midnight) would
 * leave out almost the whole of the 28th; this includes all of it.
 */
export function localDayEndIso(day: string): string {
  const p = parseIsoDate(day);
  if (!p) throw new Error(`Not a YYYY-MM-DD date: ${day}`);
  return new Date(p.year, p.month - 1, p.day, 23, 59, 59, 999).toISOString();
}

export type AuditFilterErrors = Partial<Record<keyof AuditFilters, string>>;

export function validateAuditFilters(filters: AuditFilters): AuditFilterErrors {
  const errors: AuditFilterErrors = {};
  for (const key of ["entity", "entityId", "action"] as const) {
    if (filters[key].trim().length > AUDIT_TEXT_MAX) errors[key] = `At most ${AUDIT_TEXT_MAX} characters.`;
  }
  if (filters.dateFrom && !isValidIsoDate(filters.dateFrom)) errors.dateFrom = "Enter a valid date.";
  if (filters.dateTo && !isValidIsoDate(filters.dateTo)) errors.dateTo = "Enter a valid date.";
  if (!errors.dateFrom && !errors.dateTo && filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.dateFrom = "The start date must not be after the end date.";
  }
  return errors;
}

/**
 * GET /audit-logs query: unset filters are left out, dates become the
 * local day's start/end timestamps, and limit/offset are always sent.
 */
export function auditLogParams(filters: AuditFilters, page: { limit: number; offset: number }): QueryParams {
  const params: QueryParams = {};
  for (const key of ["entity", "entityId", "userId", "action"] as const) {
    const value = filters[key].trim();
    if (value !== "") params[key] = value;
  }
  if (filters.dateFrom) params.dateFrom = localDayStartIso(filters.dateFrom);
  if (filters.dateTo) params.dateTo = localDayEndIso(filters.dateTo);
  params.limit = page.limit;
  params.offset = page.offset;
  return params;
}

export interface PageInfo {
  /** 1-based index of the first row shown, 0 when there are none. */
  from: number;
  to: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousOffset: number;
  nextOffset: number;
}

/** Paging from the `total`, `limit` and `offset` the backend returned inside `data`. */
export function pageInfo(result: { total: number; limit: number; offset: number; count: number }): PageInfo {
  const { total, limit, offset, count } = result;
  return {
    from: count === 0 ? 0 : offset + 1,
    to: offset + count,
    total,
    hasPrevious: offset > 0,
    hasNext: offset + count < total && offset + limit <= AUDIT_OFFSET_MAX,
    previousOffset: Math.max(0, offset - limit),
    nextOffset: offset + limit,
  };
}

/**
 * beforeValue/afterValue as readable text. They are arbitrary JSON or
 * null, so nothing about their shape is assumed; the result is always
 * rendered as plain text, never as HTML.
 */
export function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
