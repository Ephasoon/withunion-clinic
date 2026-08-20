import { pool } from "../config/db";
import { logger } from "../config/logger";

interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  ipAddress?: string | null;
}

/**
 * Writes an audit log row. Failures here are logged but never thrown
 * back at the caller — an audit-log write problem must not block the
 * underlying user action (e.g., a login) from completing, but it
 * must be loud in the server logs so it gets fixed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, before_value, after_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId,
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        entry.beforeValue ? JSON.stringify(entry.beforeValue) : null,
        entry.afterValue ? JSON.stringify(entry.afterValue) : null,
        entry.ipAddress ?? null,
      ]
    );
  } catch (err) {
    logger.error({ err, entry }, "Failed to write audit log entry");
  }
}
