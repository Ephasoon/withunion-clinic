import { useQuery } from "@tanstack/react-query";
import type { QueryParams } from "../../api";
import { fetchReport } from "./api";
import type { ReportType } from "./types";

/** One report, re-fetched whenever the applied params change. Reports are read-only: no mutations. */
export function useReport<T extends ReportType>(type: T, params: QueryParams) {
  return useQuery({
    queryKey: ["reports", type, params],
    queryFn: ({ signal }) => fetchReport(type, params, signal),
  });
}
