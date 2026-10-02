import type { ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { VitalsTable } from "../nursing/VitalsSection";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { LabOrderCards, PrescriptionCards } from "./ClinicalRecords";
import { hasClinicalRecords, historySummary, pastVisits, visitDiagnoses } from "./pastVisits";
import { usePatientHistory } from "./queries";
import type { PatientHistoryVisit } from "./types";

function HistoryPart({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h4>
      {empty ? <p className="text-sm text-slate-400">None recorded.</p> : children}
    </div>
  );
}

function PastVisit({ visit, defaultOpen }: { visit: PatientHistoryVisit; defaultOpen: boolean }) {
  const diagnoses = visitDiagnoses(visit);
  const summary = historySummary(visit);
  return (
    <li>
      <details open={defaultOpen} className="group rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-slate-50">
          <span className="flex flex-wrap items-center gap-2">
            <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-90">
              ▸
            </span>
            <span className="font-medium text-slate-900">{formatDateTime(visit.createdAt)}</span>
            <VisitStatusBadge status={visit.status} />
          </span>
          <span className="text-slate-500">{summary ?? "Nothing recorded"}</span>
          {diagnoses.length > 0 && (
            <span className="w-full pl-5 text-slate-700">
              Diagnoses: {diagnoses.map((d) => d.description).join("; ")}
            </span>
          )}
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-4">
          {!hasClinicalRecords(visit) ? (
            <p className="text-sm text-slate-500">Nothing clinical was recorded on this visit.</p>
          ) : (
            <>
              <HistoryPart title="Diagnoses" empty={diagnoses.length === 0}>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {diagnoses.map((d) => (
                    <li key={d.id} className="whitespace-pre-wrap px-4 py-2 text-sm text-slate-900">
                      {d.description}
                    </li>
                  ))}
                </ul>
              </HistoryPart>
              <div className="grid gap-4 lg:grid-cols-2">
                <HistoryPart title="Prescriptions" empty={visit.prescriptions.length === 0}>
                  <PrescriptionCards prescriptions={visit.prescriptions} />
                </HistoryPart>
                <HistoryPart title="Lab orders" empty={visit.labOrders.length === 0}>
                  <LabOrderCards orders={visit.labOrders} />
                </HistoryPart>
              </div>
              <HistoryPart title="Vitals" empty={visit.vitals.length === 0}>
                <VitalsTable vitals={visit.vitals} />
              </HistoryPart>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The patient's previous visits (GET /patients/:id/history), newest first and
 * open, the rest collapsed to a one-line summary. Mount only after the visit
 * has loaded; the visit being worked on is never listed.
 */
export function PatientHistory({ patientId, currentVisitId }: { patientId: string; currentVisitId: string }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Patient history</h2>
      <PastVisits patientId={patientId} currentVisitId={currentVisitId} />
    </div>
  );
}

function PastVisits({ patientId, currentVisitId }: { patientId: string; currentVisitId: string }) {
  const history = usePatientHistory(patientId, currentVisitId, true);
  if (history.isPending) return <LoadingState label="Loading patient history…" />;
  if (history.isError) return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  const visits = pastVisits(history.data, currentVisitId);
  if (visits.length === 0) return <EmptyState>No previous visits for this patient.</EmptyState>;
  return (
    <ul className="space-y-3">
      {visits.map((visit, index) => (
        <PastVisit key={visit.id} visit={visit} defaultOpen={index === 0} />
      ))}
    </ul>
  );
}
