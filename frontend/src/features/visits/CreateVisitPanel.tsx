import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { MutationError } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { PATIENT_INACTIVE_MESSAGE } from "../../lib/errorMessages";
import type { Patient } from "../patients/types";
import { useCreateVisit } from "./queries";
import { createVisitPanelState, type VisitHistoryState } from "./visitActions";
import { VisitStatusBadge } from "./VisitStatusBadge";

/**
 * POST /visits for this patient. Shown to reception only. The backend
 * refuses an inactive patient (PATIENT_INACTIVE), so for one this panel
 * offers no button, only the way to reactivate. It does not check for an
 * existing open visit (docs §5.4), so this panel does: it warns and asks
 * for a second, explicit click.
 */
export function CreateVisitPanel({
  patient,
  history,
}: {
  patient: Patient;
  /** State of the patient's visit history, used to look for open visits. */
  history: VisitHistoryState;
}) {
  const navigate = useNavigate();
  const createVisit = useCreateVisit(patient.id);
  const [confirming, setConfirming] = useState(false);
  const state = createVisitPanelState(patient.status, history);

  if (state.kind === "inactive") {
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">New visit</h2>
        <p role="status" className="rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-800">
          {PATIENT_INACTIVE_MESSAGE}
        </p>
        <Link
          to={`/patients/${patient.id}/edit`}
          className="inline-block rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Edit patient
        </Link>
      </div>
    );
  }

  const openVisits = state.kind === "ready" ? state.openVisits : [];

  const create = () =>
    createVisit.mutate(undefined, {
      onSuccess: (visit) => navigate(`/visits/${visit.id}`),
    });

  const onClick = () => {
    if (createVisit.isPending || state.kind !== "ready") return;
    if (state.needsConfirmation && !confirming) {
      setConfirming(true);
      return;
    }
    create();
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">New visit</h2>

      {openVisits.length > 0 && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            This patient already has {openVisits.length === 1 ? "an open visit" : `${openVisits.length} open visits`}.
          </p>
          <ul className="mt-2 space-y-1">
            {openVisits.map((visit) => (
              <li key={visit.id} className="flex flex-wrap items-center gap-2">
                <VisitStatusBadge status={visit.status} />
                <span>started {formatDateTime(visit.createdAt)}</span>
                <Link to={`/visits/${visit.id}`} className="font-medium underline">
                  Open
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2">Only create another visit if this is a separate, new attendance.</p>
        </div>
      )}
      {state.kind === "ready" && state.historyError && (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          The patient's visit history could not be loaded, so open visits could not be checked.
        </p>
      )}

      {createVisit.isError && <MutationError error={createVisit.error} />}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={createVisit.isPending || state.kind === "checking"}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            confirming ? "bg-amber-700 hover:bg-amber-800" : "bg-slate-900 hover:bg-slate-700"
          }`}
        >
          {createVisit.isPending
            ? "Creating visit…"
            : state.kind === "checking"
              ? "Checking for open visits…"
              : confirming
                ? "Yes, create another visit"
                : "Create visit"}
        </button>
        {confirming && !createVisit.isPending && (
          <button type="button" onClick={() => setConfirming(false)} className="text-sm text-slate-600 hover:underline">
            Don’t create
          </button>
        )}
      </div>
    </div>
  );
}
