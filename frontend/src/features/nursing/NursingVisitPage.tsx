import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { ErrorState, LoadingState, MutationError } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useVisit } from "../visits/queries";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { AssessmentSection } from "./AssessmentSection";
import { allowedNurseActions, assessmentFailureFollowUp, NURSE_QUEUE_STATUSES } from "./nurseActions";
import { useAssessment, useRecordAssessment, useStartNursing } from "./queries";
import { VitalsSection } from "./VitalsSection";

/**
 * Nursing view of one visit. The visit is loaded first (GET /visits/:id);
 * vitals and the assessment load only once it exists, because the vitals
 * endpoint answers [] for any well-formed id.
 */
export function NursingVisitPage() {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";

  const visitQuery = useVisit(visitId);
  const visitLoaded = visitQuery.isSuccess;
  const patientId = visitQuery.data?.visit.patientId ?? "";
  const assessment = useAssessment(visitId, visitLoaded);
  const startNursing = useStartNursing();
  const recordAssessment = useRecordAssessment(visitId, patientId);

  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return (
      <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />
    );
  }

  const { visit } = visitQuery.data;
  const actions = allowedNurseActions(role, visit.status);
  const inNursing = (NURSE_QUEUE_STATUSES as readonly string[]).includes(visit.status);
  const sentToDoctor = recordAssessment.isSuccess && visit.status === "WAITING_FOR_DOCTOR";
  const followUp =
    recordAssessment.isError && !recordAssessment.isPending && assessment.isSuccess && !visitQuery.isFetching
      ? assessmentFailureFollowUp(visit.status, assessment.data !== null)
      : null;

  return (
    <section className="space-y-6">
      <div>
        <Link to="/nursing/queue" className="text-sm text-slate-600 hover:underline">
          ← Nurse queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{visit.patientFullName}</h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Visit started {formatDateTime(visit.createdAt)}</p>
      </div>

      {sentToDoctor && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Assessment saved. The patient is now waiting for the doctor.{" "}
          <Link to="/nursing/queue" className="font-medium underline">
            Back to the nurse queue
          </Link>
        </div>
      )}

      {recordAssessment.isError && (
        <div className="space-y-2">
          <MutationError error={recordAssessment.error} />
          {followUp && (
            <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {followUp}
            </p>
          )}
        </div>
      )}

      {actions.canPickUp && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">This patient is waiting for a nurse.</p>
          {startNursing.isError && <MutationError error={startNursing.error} />}
          <button
            type="button"
            disabled={startNursing.isPending}
            onClick={() => startNursing.mutate(visit)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {startNursing.isPending ? "Starting…" : "Start nursing"}
          </button>
        </div>
      )}

      {!inNursing && !sentToDoctor && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
          This visit is {VISIT_STATUS_LABELS[visit.status].toLowerCase()}, so its nursing record is read-only.
        </p>
      )}

      <VitalsSection visitId={visit.id} patientId={visit.patientId} canRecord={actions.canRecordVitals} />

      <AssessmentSection
        assessment={assessment}
        canRecord={actions.canRecordAssessment}
        mutation={recordAssessment}
      />
    </section>
  );
}
