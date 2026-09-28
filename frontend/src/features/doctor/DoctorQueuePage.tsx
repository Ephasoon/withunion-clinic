import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatTime } from "../../lib/dates";
import { describeApiError } from "../../lib/errorMessages";
import { TODAY_QUEUE_REFRESH_MS, useTodayVisits } from "../visits/queries";
import type { Visit } from "../visits/types";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { splitDoctorQueue } from "./doctorActions";

function QueueRows({ visits }: { visits: Visit[] }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {visits.map((visit) => (
        <li key={visit.id}>
          <Link
            to={`/doctor/visits/${visit.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50"
          >
            <span className="flex flex-wrap items-center gap-3">
              <span className="w-14 text-slate-500">{formatTime(visit.createdAt)}</span>
              <span className="font-mono text-xs text-slate-600">{visit.patientCode}</span>
              <span className="font-medium text-slate-900">{visit.patientFullName}</span>
            </span>
            <VisitStatusBadge status={visit.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** GET /visits/today (role-scoped for doctors), polled; split into with doctor / lab results ready / waiting. */
export function DoctorQueuePage() {
  const today = useTodayVisits();
  const { withDoctor, labCompleted, waiting } = splitDoctorQueue(today.data ?? []);

  const sections = [
    { title: "With doctor", visits: withDoctor, empty: "No patients are with a doctor right now." },
    { title: "Lab results ready for review", visits: labCompleted, empty: "No lab results are waiting for review." },
    { title: "Waiting for doctor", visits: waiting, empty: "No patients are waiting for a doctor." },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Doctor queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Today’s visits for the doctor, oldest first. Refreshes every {TODAY_QUEUE_REFRESH_MS / 1000} seconds.
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
        <LoadingState label="Loading the doctor queue…" />
      ) : today.isError && !today.data ? (
        <ErrorState error={today.error} onRetry={() => void today.refetch()} />
      ) : (
        <>
          {today.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh the queue ({describeApiError(today.error)}). Showing the last list received.
            </p>
          )}
          {sections.map((section) => (
            <div key={section.title} className="space-y-3">
              <h2 className="text-base font-semibold text-slate-900">
                {section.title} ({section.visits.length})
              </h2>
              {section.visits.length === 0 ? (
                <EmptyState>{section.empty}</EmptyState>
              ) : (
                <QueueRows visits={section.visits} />
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
