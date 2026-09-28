import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime, todayIsoDate } from "../../lib/dates";
import { hasRole } from "../../rbac/access";
import { ROLES } from "../../rbac/roles";
import { CreateVisitPanel } from "../visits/CreateVisitPanel";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { patientAgeText } from "./patientDisplay";
import { usePatient, usePatientVisits } from "./queries";
import { GENDER_LABELS } from "./types";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/** GET /patients/:id and GET /patients/:id/visits. */
export function PatientDetailPage() {
  const { patientId = "" } = useParams();
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const patientQuery = usePatient(patientId);
  const visitsQuery = usePatientVisits(patientId);
  const today = todayIsoDate();

  if (patientQuery.isPending) return <LoadingState label="Loading patient…" />;
  if (patientQuery.isError) {
    return (
      <ErrorState
        error={patientQuery.error}
        notFound="This patient record does not exist."
        onRetry={() => void patientQuery.refetch()}
      />
    );
  }

  const patient = patientQuery.data;
  const history =
    visitsQuery.isPending
      ? ({ status: "pending" } as const)
      : visitsQuery.isError
        ? ({ status: "error" } as const)
        : ({ status: "success", visits: visitsQuery.data } as const);

  return (
    <section className="space-y-6">
      <div>
        <Link to="/patients" className="text-sm text-slate-600 hover:underline">
          ← Patients
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{patient.fullName}</h1>
          <span className="font-mono text-sm text-slate-600">{patient.patientCode}</span>
          {patient.status === "inactive" && (
            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">Inactive</span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:col-span-2">
          <Detail label="Gender">{GENDER_LABELS[patient.gender]}</Detail>
          <Detail label="Age">{patientAgeText(patient, today)}</Detail>
          <Detail label="Phone">{patient.phone ?? "—"}</Detail>
          <Detail label="Address">{patient.address ?? "—"}</Detail>
          <Detail label="Emergency contact">
            {patient.emergencyContactName || patient.emergencyContactPhone
              ? [patient.emergencyContactName, patient.emergencyContactPhone].filter(Boolean).join(" · ")
              : "—"}
          </Detail>
          <Detail label="Registered">{formatDateTime(patient.createdAt)}</Detail>
          {patient.notes && (
            <div className="sm:col-span-2">
              <Detail label="Notes">
                <span className="whitespace-pre-wrap">{patient.notes}</span>
              </Detail>
            </div>
          )}
        </dl>

        {hasRole(user, ROLES.RECEPTION) && <CreateVisitPanel patient={patient} history={history} />}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Visit history</h2>
        {visitsQuery.isPending ? (
          <LoadingState label="Loading visits…" />
        ) : visitsQuery.isError ? (
          <ErrorState error={visitsQuery.error} onRetry={() => void visitsQuery.refetch()} />
        ) : visitsQuery.data.length === 0 ? (
          <EmptyState>This patient has no visits yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {visitsQuery.data.map((visit) => (
              <li key={visit.id}>
                <Link
                  to={`/visits/${visit.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="text-sm text-slate-900">{formatDateTime(visit.createdAt)}</span>
                  <span className="flex items-center gap-3">
                    {visit.cancelReason && (
                      <span className="max-w-xs truncate text-xs text-slate-500">“{visit.cancelReason}”</span>
                    )}
                    <VisitStatusBadge status={visit.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
