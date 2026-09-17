import { pool } from "../../config/db";

export interface AuditLogUser {
  id: string;
  fullName: string;
  username: string;
}

export interface AuditLogEntry {
  id: string;
  user: AuditLogUser | null;
  action: string;
  entity: string;
  entityId: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_full_name: string | null;
  user_username: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
  ip_address: string | null;
  created_at: string;
}

function toEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    // user_id is nullable on audit_logs (e.g. login.failed has no
    // authenticated user yet) — never a deleted user, since this
    // project never deletes users, only deactivates them.
    user: row.user_id
      ? { id: row.user_id, fullName: row.user_full_name!, username: row.user_username! }
      : null,
    action: row.action,
    entity: row.entity,
    entityId: row.entity_id,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

const AUDIT_LOG_SELECT = `
  SELECT al.id, al.user_id, u.full_name AS user_full_name, u.username AS user_username,
         al.action, al.entity, al.entity_id, al.before_value, al.after_value,
         al.ip_address, al.created_at
  FROM audit_logs al
  LEFT JOIN users u ON u.id = al.user_id
`;

export interface AuditLogFilters {
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset: number;
}

/**
 * Every filter is applied via a parameterized WHERE clause built
 * from a fixed set of known columns — never string-interpolated
 * from request input, per the required "no raw SQL from user input"
 * constraint. Returns both the page of results and the total
 * matching count (pre-limit/offset), so callers can build real
 * pagination rather than guessing whether more pages exist.
 */
export async function listAuditLogs(
  filters: AuditLogFilters
): Promise<{ logs: AuditLogEntry[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.entity) {
    conditions.push(`al.entity = $${i++}`);
    params.push(filters.entity);
  }
  if (filters.entityId) {
    conditions.push(`al.entity_id = $${i++}`);
    params.push(filters.entityId);
  }
  if (filters.userId) {
    conditions.push(`al.user_id = $${i++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`al.action = $${i++}`);
    params.push(filters.action);
  }
  if (filters.dateFrom) {
    conditions.push(`al.created_at >= $${i++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push(`al.created_at <= $${i++}`);
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query<{ count: string }>(
    `SELECT count(*) FROM audit_logs al ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0].count);

  const limitParamIndex = i++;
  const offsetParamIndex = i++;
  const dataParams = [...params, filters.limit, filters.offset];

  const result = await pool.query<AuditLogRow>(
    `${AUDIT_LOG_SELECT}
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
    dataParams
  );

  return { logs: result.rows.map(toEntry), total };
}

export async function getAuditLogById(id: string): Promise<AuditLogEntry | null> {
  const result = await pool.query<AuditLogRow>(`${AUDIT_LOG_SELECT} WHERE al.id = $1`, [id]);
  return result.rows[0] ? toEntry(result.rows[0]) : null;
}
