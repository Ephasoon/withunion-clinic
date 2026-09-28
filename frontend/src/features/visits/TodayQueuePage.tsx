import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { describeApiError } from "../../lib/errorMessages";
import { formatTime } from "../../lib/dates";
import { TODAY_QUEUE_REFRESH_MS, useTodayVisits } from "./queries";
import { isTerminalStatus } from "./visitActions";
import { VisitStatusBadge } from "./VisitStatusBadge";

/** GET /visits/today, refreshed every TODAY_QUEUE_REFRESH_MS. */
export function TodayQueuePage() {
  const today = useTodayVisits();
  const visits = today.data ?? [];
  const inProgress = visits.filter((v) => !isTerminalStatus(v.status)).length;
  const completed = visits.filter((v) => v.status === "COMPLETED").length;
  const cancelled = visits.filter((v) => v.status === "CANCELLED").length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Today’s queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Visits created today, oldest first. Refreshes every {TODAY_QUEUE_REFRESH_MS / 1000} seconds. Visits started
            on earlier days are in each patient’s history.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {today.dataUpdatedAt > 0 && <span>Updated {formatTime(new Date(today.dataUpdatedAt).toISOString())}</span>}
          <button
            type="button"
            onClick={() => void today.refetch()}
            disabled={today.isFetching}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {today.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {today.isPending ? (
        <LoadingState label="Loading today’s visits…" />
      ) : today.isError && !today.data ? (
        <ErrorState error={today.error} onRetry={() => void today.refetch()} />
      ) : visits.length === 0 ? (
        <EmptyState>
          No visits have been created today.{" "}
          <Link to="/patients" className="font-medium text-slate-900 underline">
            Find a patient
          </Link>{" "}
          to start one.
        </EmptyState>
      ) : (
        <>
          {today.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh the queue ({describeApiError(today.error)}). Showing the last list received.
            </p>
          )}
          <p className="text-sm text-slate-600">
            {visits.length} {visits.length === 1 ? "visit" : "visits"} today · {inProgress} in progress · {completed}{" "}
            completed · {cancelled} cancelled
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Arrived</th>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Patient</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visits.map((visit) => (
                  <tr key={visit.id} className={isTerminalStatus(visit.status) ? "text-slate-500" : undefined}>
                    <td className="whitespace-nowrap px-4 py-2">{formatTime(visit.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{visit.patientCode}</td>
                    <td className="px-4 py-2">
                      <Link to={`/patients/${visit.patientId}`} className="hover:underline">
                        {visit.patientFullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <VisitStatusBadge status={visit.status} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link to={`/visits/${visit.id}`} className="font-medium text-slate-900 hover:underline">
                        Open visit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
