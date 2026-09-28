import { Link, useNavigate, useParams } from "react-router";
import { isApiError } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { describeApiError } from "../../lib/errorMessages";
import { formatDateTime } from "../../lib/dates";
import { useVisit } from "../visits/queries";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { ConsultationsList, LabOrdersList, NursingSummary, PrescriptionsList } from "./ClinicalRecords";
import { allowedDoctorVisitActions, findOpenConsultation } from "./doctorActions";
import { openConsultationErrorMessage } from "./doctorErrors";
import {
  useOpenConsultation,
  useTakeBackForReview,
  useVisitConsultations,
  useVisitLabOrders,
  useVisitPrescriptions,
} from "./queries";

/**
 * The doctor's view of a visit: its clinical context and the entry
 * points into a consultation. The visit loads first; everything
 * visit-scoped loads only once it exists.
 */
export function DoctorVisitPage() {
  const { visitId = "" } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;

  const visitQuery = useVisit(visitId);
  const loaded = visitQuery.isSuccess;
  const consultations = useVisitConsultations(visitId, loaded);
  const labOrders = useVisitLabOrders(visitId, loaded);
  const prescriptions = useVisitPrescriptions(visitId, loaded);
  const open = useOpenConsultation();
  const takeBack = useTakeBackForReview();

  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return (
      <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />
    );
  }

  const { visit } = visitQuery.data;
  const openConsultation = consultations.isSuccess ? findOpenConsultation(consultations.data) : null;
  const actions = allowedDoctorVisitActions(user?.role ?? "", visit.status, openConsultation !== null);
  const busy = open.isPending || takeBack.isPending;
  const consultationsKnown = consultations.isSuccess;

  const goToConsultation = (consultationId: string) => navigate(`/doctor/consultations/${consultationId}`);
  const startConsultation = () => open.mutate(visit.id, { onSuccess: (c) => goToConsultation(c.id) });
  // LAB_COMPLETED → WITH_DOCTOR (the only generic transition the doctor screens send), then a review consultation.
  // If the second step fails, the visit is WITH_DOCTOR and the page offers "Open review consultation".
  const reviewLabResults = () =>
    takeBack.mutate(visit.id, { onSuccess: () => startConsultation() });

  const alreadyOpen = open.isError && isApiError(open.error) && open.error.code === "CONSULTATION_ALREADY_OPEN";

  return (
    <section className="space-y-6">
      <div>
        <Link to="/doctor/queue" className="text-sm text-slate-600 hover:underline">
          ← Doctor queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{visit.patientFullName}</h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Visit started {formatDateTime(visit.createdAt)}</p>
      </div>

      {(actions.canStartConsultation || actions.canTakeBackForReview || actions.canOpenReviewConsultation ||
        openConsultation || open.isError || takeBack.isError) && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          {takeBack.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {describeApiError(takeBack.error)}
            </p>
          )}
          {open.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {openConsultationErrorMessage(open.error)}{" "}
              {alreadyOpen && openConsultation && (
                <Link to={`/doctor/consultations/${openConsultation.id}`} className="font-medium underline">
                  Go to the open consultation
                </Link>
              )}
            </p>
          )}

          {openConsultation && (
            <p className="text-sm text-slate-700">
              {openConsultation.doctorId === user?.id
                ? "You have an open consultation on this visit."
                : "Another doctor has an open consultation on this visit."}{" "}
              <Link to={`/doctor/consultations/${openConsultation.id}`} className="font-medium text-slate-900 underline">
                {openConsultation.doctorId === user?.id ? "Continue the consultation" : "View it"}
              </Link>
            </p>
          )}

          {actions.canStartConsultation && (
            <button
              type="button"
              onClick={startConsultation}
              disabled={busy || !consultationsKnown}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {open.isPending ? "Starting…" : "Start consultation"}
            </button>
          )}
          {actions.canTakeBackForReview && (
            <div className="space-y-2">
              <p className="text-sm text-slate-700">Lab results are ready. Take the patient back to review them.</p>
              <button
                type="button"
                onClick={reviewLabResults}
                disabled={busy || !consultationsKnown}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? "Opening review…" : "Review lab results"}
              </button>
            </div>
          )}
          {actions.canOpenReviewConsultation && (
            <button
              type="button"
              onClick={startConsultation}
              disabled={busy || !consultationsKnown}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {open.isPending ? "Opening…" : "Open review consultation"}
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Consultations</h2>
        <ConsultationsList query={consultations} currentUserId={user?.id ?? null} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Lab orders</h2>
          <LabOrdersList query={labOrders} empty="No lab tests have been ordered on this visit." />
        </div>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Prescriptions</h2>
          <PrescriptionsList query={prescriptions} empty="No medicines have been prescribed on this visit." />
        </div>
      </div>

      <NursingSummary visitId={visit.id} patientId={visit.patientId} />
    </section>
  );
}
