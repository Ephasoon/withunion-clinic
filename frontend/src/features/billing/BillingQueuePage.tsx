import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatTime } from "../../lib/dates";
import { describeApiError } from "../../lib/errorMessages";
import { formatMoney } from "./money";
import { BILLING_WORK_REFRESH_MS, useBillingWork } from "./queries";

/** GET /billing/invoices (reception only): every visit waiting for billing, any date, oldest first. */
export function BillingQueuePage() {
  const work = useBillingWork();

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Billing</h1>
          <p className="mt-1 text-xs text-slate-500">
            Every visit waiting for billing, from any day, oldest first. Refreshes every {BILLING_WORK_REFRESH_MS / 1000}{" "}
            seconds.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {work.dataUpdatedAt > 0 && <span>Updated {formatTime(new Date(work.dataUpdatedAt).toISOString())}</span>}
          <button
            type="button"
            onClick={() => void work.refetch()}
            disabled={work.isFetching}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {work.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {work.isPending ? (
        <LoadingState label="Loading billing work…" />
      ) : work.isError && !work.data ? (
        <ErrorState error={work.error} onRetry={() => void work.refetch()} />
      ) : work.data.length === 0 ? (
        <EmptyState>No visits are waiting for billing.</EmptyState>
      ) : (
        <>
          {work.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh ({describeApiError(work.error)}). Showing the last list received.
            </p>
          )}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {work.data.map((item) => (
              <li key={item.visitId}>
                <Link
                  to={`/billing/visits/${item.visitId}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
                >
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-slate-600">{item.patientCode}</span>
                    <span className="font-medium text-slate-900">{item.patientFullName}</span>
                  </span>
                  {item.invoice === null ? (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900">
                      No invoice yet
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">
                      {item.invoice.items.length} {item.invoice.items.length === 1 ? "charge" : "charges"} · total{" "}
                      {formatMoney(item.invoice.total)} · balance{" "}
                      <span className="font-medium text-slate-900">{formatMoney(item.invoice.balance)}</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
