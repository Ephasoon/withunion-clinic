import { api, type QueryParams } from "../../api";
import type { AuditLogEntry, AuditLogPage } from "./types";

/** GET /audit-logs → { logs, total, limit, offset } — owner; pagination is inside data, createdAt DESC. */
export async function fetchAuditLogs(params: QueryParams, signal?: AbortSignal): Promise<AuditLogPage> {
  return api.get<AuditLogPage>("/api/v1/audit-logs", { query: params, signal });
}

/** GET /audit-logs/:id → { log }. */
export async function fetchAuditLog(logId: string, signal?: AbortSignal): Promise<AuditLogEntry> {
  const { log } = await api.get<{ log: AuditLogEntry }>(`/api/v1/audit-logs/${encodeURIComponent(logId)}`, { signal });
  return log;
}
