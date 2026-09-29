import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { QueryParams } from "../../api";
import { fetchAuditLog, fetchAuditLogs } from "./api";

/** The audit log is read-only: no mutations. */
export function useAuditLogs(params: QueryParams) {
  return useQuery({
    queryKey: ["audit-logs", "list", params],
    queryFn: ({ signal }) => fetchAuditLogs(params, signal),
    // Keep the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

export function useAuditLog(logId: string) {
  return useQuery({ queryKey: ["audit-logs", "detail", logId], queryFn: ({ signal }) => fetchAuditLog(logId, signal) });
}
