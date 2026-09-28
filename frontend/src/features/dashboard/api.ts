import { api } from "../../api";
import type { DashboardSnapshot } from "./types";

/**
 * GET /api/v1/dashboard — owner only. The envelope's `data` is the
 * snapshot itself, so it is returned as-is (no `{ dashboard }` key).
 */
export async function fetchDashboard(signal?: AbortSignal): Promise<DashboardSnapshot> {
  return api.get<DashboardSnapshot>("/api/v1/dashboard", { signal });
}
