import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useVisit } from "./queries";
import { VisitActionsPanel } from "./VisitActionsPanel";
import { VISIT_STATUS_LABELS } from "./visitStatus";
import { VisitStatusBadge } from "./VisitStatusBadge";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/** GET /visits/:id → { visit, history }, plus the role's own actions. */
export function VisitDetailPage() {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const visitQuery = useVisit(visitId);

  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return (
      <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />
    );
  }

  const { visit, history } = visitQuery.data;

  return (
    <section className="space-y-6">
      <div>
        <Link to="/visits/today" className="text-sm text-slate-600 hover:underline">
          ← Today’s queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            Visit —{" "}
            <Link to={`/patients/${visit.patientId}`} className="hover:underline">
              {visit.patientFullName}
            </Link>
          </h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:col-span-2">
          <Detail label="Status">{VISIT_STATUS_LABELS[visit.status]}</Detail>
          <Detail label="Started">{formatDateTime(visit.createdAt)}</Detail>
          {visit.completedAt && <Detail label="Completed">{formatDateTime(visit.completedAt)}</Detail>}
          {visit.cancelledAt && <Detail label="Cancelled">{formatDateTime(visit.cancelledAt)}</Detail>}
          {visit.cancelReason && (
            <div className="sm:col-span-2">
              <Detail label="Cancellation reason">
                <span className="whitespace-pre-wrap">{visit.cancelReason}</span>
              </Detail>
            </div>
          )}
        </dl>

        {user && <VisitActionsPanel visit={visit} role={user.role} />}
      </div>

      {(visit.status === "WAITING_FOR_BILLING" || visit.status === "COMPLETED") && (
        <Link
          to={`/billing/visits/${visit.id}`}
          className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          {visit.status === "COMPLETED" ? "Invoice and receipt" : "Billing"}
        </Link>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">History</h2>
        {history.length === 0 ? (
          <EmptyState>No status changes have been recorded for this visit.</EmptyState>
        ) : (
          <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="text-slate-900">
                    {event.fromStatus === null ? (
                      <>Visit created — {VISIT_STATUS_LABELS[event.toStatus]}</>
                    ) : (
                      <>
                        {VISIT_STATUS_LABELS[event.fromStatus]} → {VISIT_STATUS_LABELS[event.toStatus]}
                      </>
                    )}
                    {user && event.changedBy === user.id && <span className="text-slate-500"> (by you)</span>}
                  </p>
                  {event.reason && <p className="mt-0.5 whitespace-pre-wrap text-slate-600">“{event.reason}”</p>}
                </div>
                <time dateTime={event.changedAt} className="whitespace-nowrap text-slate-500">
                  {formatDateTime(event.changedAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
