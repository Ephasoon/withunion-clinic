import { Link, useNavigate } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState, MutationError } from "../../components/QueryStates";
import { formatTime } from "../../lib/dates";
import { describeApiError } from "../../lib/errorMessages";
import { TODAY_QUEUE_REFRESH_MS, useTodayVisits } from "../visits/queries";
import type { Visit } from "../visits/types";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { allowedNurseActions, splitNurseQueue } from "./nurseActions";
import { useStartNursing } from "./queries";

/** GET /visits/today (role-scoped for nurses), polled; split into "with nurse" and "waiting". */
export function NurseQueuePage() {
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";
  const today = useTodayVisits();
  const startNursing = useStartNursing();
  const navigate = useNavigate();

  const { waiting, withNurse } = splitNurseQueue(today.data ?? []);

  const pickUp = (visit: Visit) => {
    if (startNursing.isPending) return;
    startNursing.mutate(visit, { onSuccess: () => navigate(`/nursing/visits/${visit.id}`) });
  };

  const renderRows = (visits: Visit[], showPickUp: boolean) => (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {visits.map((visit) => {
        const actions = allowedNurseActions(role, visit.status);
        const failed = startNursing.isError && startNursing.variables?.id === visit.id;
        return (
          <li key={visit.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-14 text-slate-500">{formatTime(visit.createdAt)}</span>
                <span className="font-mono text-xs text-slate-600">{visit.patientCode}</span>
                <span className="font-medium text-slate-900">{visit.patientFullName}</span>
                <VisitStatusBadge status={visit.status} />
              </div>
              <div className="flex items-center gap-3">
                {showPickUp && actions.canPickUp && (
                  <button
                    type="button"
                    onClick={() => pickUp(visit)}
                    disabled={startNursing.isPending}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {startNursing.isPending && startNursing.variables?.id === visit.id ? "Starting…" : "Start nursing"}
                  </button>
                )}
                <Link to={`/nursing/visits/${visit.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                  Open
                </Link>
              </div>
            </div>
            {failed && (
              <div className="mt-2">
                <MutationError error={startNursing.error} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Nurse queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Today’s visits waiting for or with a nurse, oldest first. Refreshes every {TODAY_QUEUE_REFRESH_MS / 1000}{" "}
            seconds.
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
        <LoadingState label="Loading the nurse queue…" />
      ) : today.isError && !today.data ? (
        <ErrorState error={today.error} onRetry={() => void today.refetch()} />
      ) : (
        <>
          {today.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh the queue ({describeApiError(today.error)}). Showing the last list received.
            </p>
          )}

          <div className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">With nurse ({withNurse.length})</h2>
            {withNurse.length === 0 ? (
              <EmptyState>No patients are with a nurse right now.</EmptyState>
            ) : (
              renderRows(withNurse, false)
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Waiting for nurse ({waiting.length})</h2>
            {waiting.length === 0 ? (
              <EmptyState>No patients are waiting for a nurse.</EmptyState>
            ) : (
              renderRows(waiting, true)
            )}
          </div>
        </>
      )}
    </section>
  );
}
