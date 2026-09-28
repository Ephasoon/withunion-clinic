import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime, formatTime } from "../../lib/dates";
import { describeApiError } from "../../lib/errorMessages";
import { formatMoney } from "../billing/money";
import { fetchDashboard } from "./api";
import { activeByRoleDisplayList, byStatusDisplayList, type DisplayRow } from "./dashboardDisplay";

export const DASHBOARD_REFRESH_MS = 30_000;

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function CountList({ rows }: { rows: DisplayRow[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
      {rows.map((row) => (
        <li key={row.key} className="flex justify-between gap-3 px-4 py-2">
          <span className={row.count === 0 ? "text-slate-500" : "text-slate-900"}>{row.label}</span>
          <span className={`tabular-nums ${row.count === 0 ? "text-slate-400" : "font-medium text-slate-900"}`}>
            {row.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** GET /api/v1/dashboard (owner), polled every 30 s. Read-only: nothing here changes data. */
export function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: ({ signal }) => fetchDashboard(signal),
    refetchInterval: DASHBOARD_REFRESH_MS,
    staleTime: 0,
  });

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500">
            “Today” is the server’s date. Refreshes every {DASHBOARD_REFRESH_MS / 1000} seconds.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {dashboard.data && <span>Generated {formatDateTime(dashboard.data.generatedAt)}</span>}
          {dashboard.dataUpdatedAt > 0 && (
            <span>· refreshed {formatTime(new Date(dashboard.dataUpdatedAt).toISOString())}</span>
          )}
          <button
            type="button"
            onClick={() => void dashboard.refetch()}
            disabled={dashboard.isFetching}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {dashboard.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {dashboard.isPending ? (
        <LoadingState label="Loading the dashboard…" />
      ) : dashboard.isError && !dashboard.data ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <>
          {dashboard.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh ({describeApiError(dashboard.error)}). Showing the last snapshot received.
            </p>
          )}

          <div className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Today</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Patients registered" value={dashboard.data.patients.registeredToday} />
              <Tile label="Visits started" value={dashboard.data.visits.today} />
              <Tile label="Visits completed" value={dashboard.data.visits.completedToday} />
              <Tile label="Visits cancelled" value={dashboard.data.visits.cancelledToday} />
              <Tile label="Revenue" value={formatMoney(dashboard.data.billing.revenueToday)} />
              <Tile label="Payments" value={dashboard.data.billing.paymentsToday} />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-slate-900">Visits currently in each status</h2>
              <p className="text-xs text-slate-500">
                A live count of every unfinished visit, whatever day it started — not today’s queue. A visit started
                yesterday and still waiting is counted here.
              </p>
              <CountList rows={byStatusDisplayList(dashboard.data.visits.byStatus)} />
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Billing (all open invoices)</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tile label="Open invoices" value={dashboard.data.billing.openInvoiceCount} />
                  <Tile label="Outstanding balance" value={formatMoney(dashboard.data.billing.totalOutstandingBalance)} />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-slate-900">Inventory</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Tile label="Stock items" value={dashboard.data.inventory.totalItems} />
                  <Tile
                    label="Out of stock"
                    value={dashboard.data.inventory.outOfStockCount}
                    hint="Items with quantity on hand 0"
                  />
                </div>
              </div>
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-slate-900">
                  Active staff ({dashboard.data.staff.totalActive})
                </h2>
                <CountList rows={activeByRoleDisplayList(dashboard.data.staff.activeByRole)} />
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
