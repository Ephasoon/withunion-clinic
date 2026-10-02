import { useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useVisit } from "../visits/queries";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { ConsultationsList, LabOrdersList, NursingSummary, PrescriptionsList } from "./ClinicalRecords";
import { describeCompletionOutcome, previewCompletion } from "./completion";
import { DiagnosisForm, LabOrderForm, NotesEditor, PrescriptionForm } from "./ConsultationEditors";
import { canEditConsultation } from "./doctorActions";
import { completionErrorMessage } from "./doctorErrors";
import { PatientHistory } from "./PatientHistory";
import {
  useConsultation,
  useConsultationMutations,
  useVisitConsultations,
  useVisitLabOrders,
  useVisitPrescriptions,
} from "./queries";

/**
 * One consultation: notes, diagnoses, lab orders and prescriptions,
 * then completion. The consultation loads first, then its visit, then
 * the visit-scoped records (lab orders and prescriptions are needed for
 * the completion preview, which is visit-wide) and the patient's
 * history of previous visits.
 */
export function ConsultationPage() {
  const { consultationId = "" } = useParams();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;

  const consultationQuery = useConsultation(consultationId);
  const visitId = consultationQuery.data?.consultation.visitId ?? "";
  const visitQuery = useVisit(visitId, consultationQuery.isSuccess);
  const visitLoaded = visitQuery.isSuccess;
  const labOrders = useVisitLabOrders(visitId, visitLoaded);
  const prescriptions = useVisitPrescriptions(visitId, visitLoaded);
  const consultations = useVisitConsultations(visitId, visitLoaded);
  const { saveNotes, diagnosis, labOrder, prescription, complete } = useConsultationMutations(consultationId, visitId);
  const [notesDirty, setNotesDirty] = useState(false);

  if (consultationQuery.isPending) return <LoadingState label="Loading consultation…" />;
  if (consultationQuery.isError) {
    return (
      <ErrorState
        error={consultationQuery.error}
        notFound="This consultation does not exist."
        onRetry={() => void consultationQuery.refetch()}
      />
    );
  }
  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />;
  }

  const { consultation, diagnoses } = consultationQuery.data;
  const { visit } = visitQuery.data;
  const editable = canEditConsultation(user, consultation);
  const mine = consultation.doctorId === user?.id;
  const previewReady = labOrders.isSuccess && prescriptions.isSuccess;
  const preview = previewReady ? previewCompletion(labOrders.data, prescriptions.data) : null;
  const ofThisConsultation = <T extends { consultationId: string }>(item: T) => item.consultationId === consultation.id;

  return (
    <section className="space-y-6">
      <div>
        <Link to={`/doctor/visits/${visit.id}`} className="text-sm text-slate-600 hover:underline">
          ← Visit
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Consultation — {visit.patientFullName}</h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Started {formatDateTime(consultation.startedAt)}
          {consultation.completedAt ? ` · completed ${formatDateTime(consultation.completedAt)}` : " · open"}
          {!mine && " · another doctor’s consultation"}
        </p>
      </div>

      {complete.isSuccess && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          {describeCompletionOutcome(complete.data.visitStatus)}{" "}
          <Link to="/doctor/queue" className="font-medium underline">
            Back to the doctor queue
          </Link>
        </div>
      )}

      {!editable && !complete.isSuccess && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {consultation.completedAt
            ? "This consultation is completed and read-only."
            : mine
              ? "This consultation is read-only."
              : "Only the doctor who opened this consultation can change it. It is shown read-only."}
        </p>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Notes</h2>
        {editable ? (
          <NotesEditor
            key={consultation.id}
            initialNotes={consultation.notes ?? ""}
            mutation={saveNotes}
            onDirtyChange={setNotesDirty}
          />
        ) : consultation.notes ? (
          <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900">
            {consultation.notes}
          </p>
        ) : (
          <EmptyState>No notes were written.</EmptyState>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Diagnoses</h2>
        {diagnoses.length === 0 ? (
          <EmptyState>No diagnoses recorded yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {diagnoses.map((d) => (
              <li key={d.id} className="whitespace-pre-wrap px-4 py-2 text-sm text-slate-900">
                {d.description}
              </li>
            ))}
          </ul>
        )}
        {editable && <DiagnosisForm mutation={diagnosis} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Lab orders from this consultation</h2>
          <LabOrdersList query={labOrders} filter={ofThisConsultation} empty="No lab tests ordered in this consultation." />
          {editable && <LabOrderForm mutation={labOrder} />}
        </div>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Prescriptions from this consultation</h2>
          <PrescriptionsList
            query={prescriptions}
            filter={ofThisConsultation}
            empty="No medicines prescribed in this consultation."
          />
          {editable && <PrescriptionForm mutation={prescription} />}
        </div>
      </div>

      {editable && (
        <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Complete consultation</h2>
          <p className="text-xs text-slate-500">
            Lab orders and prescriptions are recorded as you add them, but the lab and pharmacy only receive them
            once you complete the consultation.
          </p>
          {preview ? (
            <div className="rounded-md bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">{preview.headline}</p>
              <p className="mt-1 text-slate-700">{preview.reason}</p>
            </div>
          ) : labOrders.isError || prescriptions.isError ? (
            <ErrorState
              error={labOrders.error ?? prescriptions.error}
              onRetry={() => {
                void labOrders.refetch();
                void prescriptions.refetch();
              }}
            />
          ) : (
            <LoadingState label="Working out where the patient will go…" />
          )}
          {notesDirty && (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              You have unsaved notes. Save them before completing.
            </p>
          )}
          {complete.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {completionErrorMessage(complete.error, visitQuery.isFetching ? null : visit.status)}
            </p>
          )}
          <button
            type="button"
            onClick={() => complete.mutate()}
            disabled={complete.isPending || !preview || notesDirty}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {complete.isPending ? "Completing…" : "Complete consultation"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Other consultations on this visit</h2>
        <ConsultationsList query={consultations} currentUserId={user?.id ?? null} excludeId={consultation.id} />
      </div>

      <NursingSummary visitId={visit.id} patientId={visit.patientId} />

      <PatientHistory patientId={visit.patientId} currentVisitId={visit.id} />
    </section>
  );
}
