import { api, type QueryParams } from "../../api";
import type { FinancialReport, PharmacyDispensingReport, PurchasingReport, ReportType, VisitsReport } from "./types";

interface ReportByType {
  visits: VisitsReport;
  financial: FinancialReport;
  purchasing: PurchasingReport;
  "pharmacy-dispensing": PharmacyDispensingReport;
}

/**
 * GET /api/v1/reports/{visits|financial|purchasing|pharmacy-dispensing} → { report } — owner only.
 * `params` come from the builders in reportParams.ts (unset filters already left out).
 */
export async function fetchReport<T extends ReportType>(
  type: T,
  params: QueryParams,
  signal?: AbortSignal
): Promise<ReportByType[T]> {
  const { report } = await api.get<{ report: ReportByType[T] }>(`/api/v1/reports/${type}`, { query: params, signal });
  return report;
}
