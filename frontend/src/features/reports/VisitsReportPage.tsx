import { useState } from "react";
import { VISIT_STATUSES, type VisitStatus } from "../visits/types";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";
import { useReport } from "./queries";
import { DateRangePicker, inputClass, ReportFrame, ReportResult, SimpleTable, Stat } from "./ReportControls";
import { visitsReportParams } from "./reportParams";
import { useReportRange } from "./useReportRange";

const label = (status: string) => VISIT_STATUS_LABELS[status as VisitStatus] ?? status;

/** GET /reports/visits — counted by the day each visit was created. */
export function VisitsReportPage() {
  const [status, setStatus] = useState<VisitStatus | "">("");
  const { range, updateRange, rangeErrors, applied, run } = useReportRange((r) => visitsReportParams(r, { status: "" }));
  const report = useReport("visits", applied);

  return (
    <ReportFrame
      title="Visits"
      description="Visits by the day they were created, whatever their status now."
      running={report.isFetching}
      onRun={() => run((r) => visitsReportParams(r, { status }))}
      filters={
        <>
          <DateRangePicker value={range} onChange={updateRange} errors={rangeErrors} />
          <div>
            <label htmlFor="report-status" className="text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as VisitStatus | "")}
              className={inputClass}
            >
              <option value="">All statuses</option>
              {VISIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {VISIT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </>
      }
    >
      <ReportResult query={report} isEmpty={(r) => r.totalCount === 0} emptyText="No visits were created in this range.">
        {(r) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Visits" value={r.totalCount} />
              <Stat label="Status filter" value={r.status ? label(r.status) : "All"} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <SimpleTable
                caption="By current status"
                columns={[{ label: "Status" }, { label: "Visits", align: "right" }]}
                rows={r.byStatus.map((row) => [label(row.status), row.count])}
              />
              <SimpleTable
                caption="By day created"
                columns={[{ label: "Date" }, { label: "Visits", align: "right" }]}
                rows={r.byDate.map((row) => [row.date, row.count])}
              />
            </div>
          </>
        )}
      </ReportResult>
    </ReportFrame>
  );
}
