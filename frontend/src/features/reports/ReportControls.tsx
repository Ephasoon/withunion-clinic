import type { FormEvent, ReactNode } from "react";
import { NavLink } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { EmptyState, LoadingState } from "../../components/QueryStates";
import type { DateRange, DateRangeErrors } from "./dateRange";
import { reportErrorMessage } from "./reportErrors";

const REPORT_TABS = [
  { path: "/reports/visits", label: "Visits" },
  { path: "/reports/financial", label: "Financial" },
  { path: "/reports/purchasing", label: "Purchasing" },
  { path: "/reports/pharmacy-dispensing", label: "Pharmacy dispensing" },
] as const;

export const inputClass =
  "mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

export function ReportTabs() {
  return (
    <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b border-slate-200">
      {REPORT_TABS.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              isActive ? "border-slate-900 text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The date-range picker shared by all four reports. Values are plain "YYYY-MM-DD" strings from <input type="date">. */
export function DateRangePicker({
  value,
  onChange,
  errors,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  errors: DateRangeErrors;
}) {
  return (
    <>
      <div>
        <label htmlFor="report-dateFrom" className="text-xs font-medium text-slate-600">
          From
        </label>
        <input
          id="report-dateFrom"
          type="date"
          value={value.dateFrom}
          max={value.dateTo || undefined}
          onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          aria-invalid={errors.dateFrom ? true : undefined}
          className={inputClass}
        />
        {errors.dateFrom && <p className="mt-0.5 text-xs text-red-700">{errors.dateFrom}</p>}
      </div>
      <div>
        <label htmlFor="report-dateTo" className="text-xs font-medium text-slate-600">
          To
        </label>
        <input
          id="report-dateTo"
          type="date"
          value={value.dateTo}
          min={value.dateFrom || undefined}
          onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          aria-invalid={errors.dateTo ? true : undefined}
          className={inputClass}
        />
        {errors.dateTo && <p className="mt-0.5 text-xs text-red-700">{errors.dateTo}</p>}
      </div>
    </>
  );
}

/** Title, tabs and the filter form (range + the report's own filters) with a Run button. */
export function ReportFrame({
  title,
  description,
  onRun,
  running,
  filters,
  children,
}: {
  title: string;
  description: ReactNode;
  onRun: () => void;
  running: boolean;
  filters: ReactNode;
  children: ReactNode;
}) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onRun();
  };
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
      </div>
      <ReportTabs />
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {filters}
        <div className="flex items-end lg:pt-4">
          <button
            type="submit"
            disabled={running}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {running ? "Running…" : "Run report"}
          </button>
        </div>
      </form>
      {children}
    </section>
  );
}

/** Loading, error and empty states for a report's results. */
export function ReportResult<T extends { dateFrom: string; dateTo: string }>({
  query,
  isEmpty,
  emptyText,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty: (report: T) => boolean;
  emptyText: string;
  children: (report: T) => ReactNode;
}) {
  if (query.isPending) return <LoadingState label="Running the report…" />;
  if (query.isError) {
    return (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>{reportErrorMessage(query.error)}</p>
        <button type="button" onClick={() => void query.refetch()} className="mt-2 font-medium underline">
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className={`space-y-4 ${query.isFetching ? "opacity-60 transition-opacity" : ""}`}>
      <p className="text-sm text-slate-600">
        {query.data.dateFrom} to {query.data.dateTo} (inclusive)
      </p>
      {isEmpty(query.data) ? <EmptyState>{emptyText}</EmptyState> : children(query.data)}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/** A small read-only table. `align` right-aligns numeric columns. */
export function SimpleTable({
  caption,
  columns,
  rows,
  empty = "Nothing in this range.",
}: {
  caption: string;
  columns: Array<{ label: string; align?: "right" }>;
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{caption}</h3>
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} className={`px-3 py-2 ${c.align === "right" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((cells, i) => (
                <tr key={i}>
                  {cells.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-3 py-2 ${columns[j]?.align === "right" ? "text-right tabular-nums" : ""}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
