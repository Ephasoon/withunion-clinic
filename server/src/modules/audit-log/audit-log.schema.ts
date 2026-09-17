import { z } from "zod";

/**
 * entityId is intentionally a plain string, not a uuid — the
 * audit_logs.entity_id column is varchar(64) and stores non-uuid
 * values too (e.g. "login.failed" records the attempted username
 * as entity_id, since no user row exists to reference).
 *
 * dateFrom/dateTo use z.coerce.date() so both a bare date
 * ("2026-01-01") and a full ISO timestamp are accepted and
 * malformed values are rejected as a normal 400, matching the
 * project's existing query-validation convention (Patients' search
 * query schema).
 */
export const AuditLogQuerySchema = z
  .object({
    entity: z.string().trim().min(1).max(64).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    userId: z.string().uuid("userId must be a valid uuid").optional(),
    action: z.string().trim().min(1).max(64).optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
