import { Link, useNavigate } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime, formatTime } from "../../lib/dates";
import { describeApiError } from "../../lib/errorMessages";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { allowedPharmacyActions, groupPrescriptionsByVisit } from "./pharmacyActions";
import { pharmacyErrorMessage } from "./pharmacyErrors";
import { PHARMACY_QUEUE_REFRESH_MS, usePharmacyQueue, useStartPharmacy } from "./queries";

/** GET /pharmacy/prescriptions (pharmacy only), polled, one group per visit. */
export function PharmacyQueuePage() {
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";
  const queue = usePharmacyQueue();
  const start = useStartPharmacy();
  const navigate = useNavigate();
  const groups = groupPrescriptionsByVisit(queue.data ?? []);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pharmacy queue</h1>
          <p className="mt-1 text-xs text-slate-500">
            Visits waiting for or at the pharmacy, oldest first. Refreshes every {PHARMACY_QUEUE_REFRESH_MS / 1000} seconds.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {queue.dataUpdatedAt > 0 && <span>Updated {formatTime(new Date(queue.dataUpdatedAt).toISOString())}</span>}
          <button
            type="button"
            onClick={() => void queue.refetch()}
            disabled={queue.isFetching}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {queue.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {queue.isPending ? (
        <LoadingState label="Loading the pharmacy queue…" />
      ) : queue.isError && !queue.data ? (
        <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState>No prescriptions are waiting.</EmptyState>
      ) : (
        <>
          {queue.isError && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Could not refresh the queue ({describeApiError(queue.error)}). Showing the last list received.
            </p>
          )}
          <ul className="space-y-4">
            {groups.map((group) => {
              const first = group.prescriptions[0]!;
              const actions = allowedPharmacyActions(role, group.visitStatus);
              const failed = start.isError && start.variables?.visitId === group.visitId;
              return (
                <li key={group.visitId} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-slate-600">{group.patientCode}</span>
                      <span className="font-medium text-slate-900">{group.patientFullName}</span>
                      <VisitStatusBadge status={group.visitStatus} />
                    </div>
                    {actions.canStart && (
                      <button
                        type="button"
                        disabled={start.isPending}
                        onClick={() =>
                          start.mutate(first, { onSuccess: () => navigate(`/pharmacy/prescriptions/${first.id}`) })
                        }
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {start.isPending && start.variables?.visitId === group.visitId ? "Starting…" : "Start dispensing"}
                      </button>
                    )}
                  </div>
                  {failed && (
                    <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                      {pharmacyErrorMessage(start.error)}
                    </p>
                  )}
                  <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
                    {group.prescriptions.map((p) => {
                      const pending = p.items.filter((i) => i.status === "PENDING").length;
                      return (
                        <li key={p.id}>
                          <Link
                            to={`/pharmacy/prescriptions/${p.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                          >
                            <span className="text-slate-900">{p.items.map((i) => i.medicineName).join(", ")}</span>
                            <span className="text-xs text-slate-500">
                              {pending} of {p.items.length} not yet dispensed · {p.doctorName},{" "}
                              {formatDateTime(p.createdAt)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
