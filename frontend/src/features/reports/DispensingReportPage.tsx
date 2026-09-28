import { useState } from "react";
import { useReport } from "./queries";
import { DateRangePicker, inputClass, ReportFrame, ReportResult, SimpleTable, Stat } from "./ReportControls";
import { ALWAYS_EMPTY_DISPENSING_STATUSES, pharmacyDispensingReportParams } from "./reportParams";
import { DISPENSING_STATUSES, type DispensingStatus } from "./types";
import { useReportRange } from "./useReportRange";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Not dispensed",
  PARTIALLY_DISPENSED: "Partly dispensed",
  DISPENSED: "Dispensed",
  UNAVAILABLE: "Unavailable",
};

/** GET /reports/pharmacy-dispensing — only items actually dispensed, by the day they were dispensed. */
export function DispensingReportPage() {
  const [status, setStatus] = useState<DispensingStatus | "">("");
  const { range, updateRange, rangeErrors, applied, run } = useReportRange((r) =>
    pharmacyDispensingReportParams(r, { status: "" })
  );
  const report = useReport("pharmacy-dispensing", applied);
  const alwaysEmpty = status !== "" && ALWAYS_EMPTY_DISPENSING_STATUSES.includes(status);

  return (
    <ReportFrame
      title="Pharmacy dispensing"
      description="Medicines dispensed, by the day they were dispensed. Only items with a dispense recorded are counted."
      running={report.isFetching}
      onRun={() => run((r) => pharmacyDispensingReportParams(r, { status }))}
      filters={
        <>
          <DateRangePicker value={range} onChange={updateRange} errors={rangeErrors} />
          <div className="sm:col-span-2">
            <label htmlFor="report-status" className="text-xs font-medium text-slate-600">
              Item status
            </label>
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as DispensingStatus | "")}
              className={inputClass}
            >
              <option value="">All</option>
              {DISPENSING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <p className={`mt-0.5 text-xs ${alwaysEmpty ? "text-amber-800" : "text-slate-500"}`}>
              “Not dispensed” and “Unavailable” always show 0: this report only counts items that were actually
              dispensed.
            </p>
          </div>
        </>
      }
    >
      <ReportResult
        query={report}
        isEmpty={(r) => r.totalItemsDispensed === 0}
        emptyText={
          report.data?.status && ALWAYS_EMPTY_DISPENSING_STATUSES.includes(report.data.status as DispensingStatus)
            ? "No rows — as expected for this status, since the report only counts items that were dispensed."
            : "Nothing was dispensed in this range."
        }
      >
        {(r) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Items dispensed" value={r.totalItemsDispensed} />
              <Stat label="Units dispensed" value={r.totalQuantityDispensed.toLocaleString()} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <SimpleTable
                caption="By item status"
                columns={[{ label: "Status" }, { label: "Items", align: "right" }, { label: "Units", align: "right" }]}
                rows={r.byStatus.map((s) => [STATUS_LABELS[s.status] ?? s.status, s.itemCount, s.totalQuantityDispensed])}
              />
              <SimpleTable
                caption="By day dispensed"
                columns={[{ label: "Date" }, { label: "Items", align: "right" }, { label: "Units", align: "right" }]}
                rows={r.byDate.map((d) => [d.date, d.itemCount, d.totalQuantityDispensed])}
              />
            </div>
          </>
        )}
      </ReportResult>
    </ReportFrame>
  );
}
