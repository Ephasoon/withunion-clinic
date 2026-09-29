/** docs/api-inventory.md §4 AuditLogEntry and §5.12. */
export interface AuditLogEntry {
  id: string;
  /** null for events with no user, e.g. login.failed. */
  user: { id: string; fullName: string; username: string } | null;
  action: string;
  entity: string;
  /** Usually a UUID; the attempted username for login.failed. */
  entityId: string | null;
  /** Arbitrary JSON (or null) — no fixed shape. */
  beforeValue: unknown;
  afterValue: unknown;
  ipAddress: string | null;
  createdAt: string;
}

/** GET /audit-logs → data. Pagination lives INSIDE data, not in meta. */
export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}
