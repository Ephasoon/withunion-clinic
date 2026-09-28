import { useState } from "react";
import type { QueryParams } from "../../api";
import { todayIsoDate } from "../../lib/dates";
import { getSessionRange, setSessionRange, validateDateRange, type DateRange, type DateRangeErrors } from "./dateRange";

/**
 * Shared state for a report page: the range being edited, its errors,
 * and the params actually applied. The report runs straight away with the
 * session's range (or the default), and again whenever `run` succeeds.
 */
export function useReportRange(buildInitial: (range: DateRange) => QueryParams) {
  const [range, setRange] = useState<DateRange>(() => getSessionRange(todayIsoDate()));
  const [rangeErrors, setRangeErrors] = useState<DateRangeErrors>({});
  const [applied, setApplied] = useState<QueryParams>(() => buildInitial(getSessionRange(todayIsoDate())));

  const updateRange = (next: DateRange) => {
    setRange(next);
    setRangeErrors({});
  };

  /** Validates the range (and any extra check); on success remembers it for this session and applies `build(range)`. */
  const run = (build: (range: DateRange) => QueryParams, extraValid = true): boolean => {
    const result = validateDateRange(range);
    if (!result.ok) {
      setRangeErrors(result.errors);
      return false;
    }
    if (!extraValid) return false;
    setSessionRange(range);
    setApplied(build(range));
    return true;
  };

  return { range, updateRange, rangeErrors, applied, run };
}
