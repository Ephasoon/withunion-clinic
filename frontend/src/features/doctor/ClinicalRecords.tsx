import type { ReactNode } from "react";
import { Link } from "react-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { AssessmentView } from "../nursing/AssessmentSection";
import { useAssessment } from "../nursing/queries";
import { VitalsSection } from "../nursing/VitalsSection";
import type { ConsultationWithDiagnoses, LabOrderDetail, PrescriptionDetail } from "./types";

/** Read-only clinical records shown on the doctor's visit and consultation pages. */

/** Loading, error and empty states for a list query; `select` narrows the list (e.g. to one consultation). */
function QueryList<T>({
  query,
  select = (items) => items,
  loadingLabel,
  empty,
  children,
}: {
  query: UseQueryResult<T[]>;
  select?: (items: T[]) => T[];
  loadingLabel: string;
  empty: string;
  children: (items: T[]) => ReactNode;
}) {
  if (query.isPending) return <LoadingState label={loadingLabel} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const items = select(query.data);
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return <>{children(items)}</>;
}

/** Nursing assessment (read-only) and every vitals set. Mount only after the visit has loaded. */
export function NursingSummary({ visitId, patientId }: { visitId: string; patientId: string }) {
  const assessment = useAssessment(visitId, true);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Nursing assessment</h2>
        {assessment.isPending ? (
          <LoadingState label="Loading assessment…" />
        ) : assessment.isError ? (
          <ErrorState error={assessment.error} onRetry={() => void assessment.refetch()} />
        ) : assessment.data ? (
          <AssessmentView assessment={assessment.data} />
        ) : (
          <EmptyState>No nursing assessment was recorded (nursing may have been skipped).</EmptyState>
        )}
      </div>
      <VitalsSection visitId={visitId} patientId={patientId} canRecord={false} />
    </div>
  );
}

export function LabOrdersList({
  query,
  filter,
  empty,
}: {
  query: UseQueryResult<LabOrderDetail[]>;
  filter?: (order: LabOrderDetail) => boolean;
  empty: string;
}) {
  return (
    <QueryList
      query={query}
      select={filter ? (orders) => orders.filter(filter) : undefined}
      loadingLabel="Loading lab orders…"
      empty={empty}
    >
      {(orders) => (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-600">
                  Ordered {formatDateTime(order.requestedAt)} by {order.requestedByName}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    order.status === "REQUESTED" ? "bg-amber-100 text-amber-900" : "bg-green-100 text-green-900"
                  }`}
                >
                  {order.status === "REQUESTED" ? "Waiting for results" : "Results complete"}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {order.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-slate-900">{item.testName}:</span>
                    <span className={item.result ? "whitespace-pre-wrap text-slate-800" : "text-slate-400"}>
                      {item.result ?? "no result yet"}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </QueryList>
  );
}

const ITEM_STATUS_LABELS = {
  PENDING: "Not dispensed yet",
  PARTIALLY_DISPENSED: "Partly dispensed",
  DISPENSED: "Dispensed",
  UNAVAILABLE: "Unavailable",
} as const;

export function PrescriptionsList({
  query,
  filter,
  empty,
}: {
  query: UseQueryResult<PrescriptionDetail[]>;
  filter?: (p: PrescriptionDetail) => boolean;
  empty: string;
}) {
  return (
    <QueryList
      query={query}
      select={filter ? (prescriptions) => prescriptions.filter(filter) : undefined}
      loadingLabel="Loading prescriptions…"
      empty={empty}
    >
      {(prescriptions) => (
        <ul className="space-y-3">
          {prescriptions.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="text-slate-600">
                Prescribed {formatDateTime(p.createdAt)} by {p.doctorName}
              </p>
              <ul className="mt-2 space-y-1">
                {p.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium text-slate-900">{item.medicineName}</span>
                      <span className="text-slate-600">
                        {[item.strength, item.dosage, item.frequency, item.duration].filter(Boolean).length > 0 &&
                          ` — ${[item.strength, item.dosage, item.frequency, item.duration].filter(Boolean).join(", ")}`}
                        {item.quantityPrescribed !== null && ` · qty ${item.quantityPrescribed}`}
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">{ITEM_STATUS_LABELS[item.status]}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </QueryList>
  );
}

export function ConsultationsList({
  query,
  currentUserId,
  excludeId,
}: {
  query: UseQueryResult<ConsultationWithDiagnoses[]>;
  currentUserId: string | null;
  excludeId?: string;
}) {
  return (
    <QueryList
      query={query}
      select={excludeId ? (list) => list.filter((c) => c.id !== excludeId) : undefined}
      loadingLabel="Loading consultations…"
      empty={excludeId ? "No other consultations on this visit." : "No consultations on this visit yet."}
    >
      {(consultations) => (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {consultations.map((c) => (
            <li key={c.id}>
              <Link
                to={`/doctor/consultations/${c.id}`}
                className="block px-4 py-3 text-sm hover:bg-slate-50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-900">
                    Started {formatDateTime(c.startedAt)}
                    {c.doctorId === currentUserId && <span className="text-slate-500"> (yours)</span>}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      c.completedAt ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-900"
                    }`}
                  >
                    {c.completedAt ? "Completed" : "Open"}
                  </span>
                </div>
                {c.diagnoses.length > 0 && (
                  <p className="mt-1 text-slate-600">Diagnoses: {c.diagnoses.map((d) => d.description).join("; ")}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </QueryList>
  );
}
