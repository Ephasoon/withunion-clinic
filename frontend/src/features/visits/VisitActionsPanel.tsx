import { useState, type FormEvent } from "react";
import { MutationError } from "../../components/QueryStates";
import { validateLabOrder } from "../doctor/consultationForms";
import { activePriceListItems } from "../billing/priceListPick";
import { usePriceList } from "../priceList/queries";
import { useSendToLab, useTransitionVisit } from "./queries";
import type { Visit } from "./types";
import { allowedVisitActions, CANCEL_REASON_MAX, validateCancelReason, type VisitAction } from "./visitActions";

/**
 * The visit actions this user's role may take from the visit's current
 * status — see allowedVisitActions. Renders nothing when there are none.
 */
export function VisitActionsPanel({ visit, role }: { visit: Visit; role: string }) {
  const transition = useTransitionVisit(visit.id, visit.patientId);
  const sendToLab = useSendToLab(visit.id, visit.patientId);
  const priceList = usePriceList(role === "reception");
  const [labOpen, setLabOpen] = useState(false);
  const [labText, setLabText] = useState("");
  const [labError, setLabError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const actions = allowedVisitActions(role, visit.status);
  if (actions.length === 0) return null;

  const sendActions = actions.filter((a): a is Extract<VisitAction, { kind: "send" }> => a.kind === "send");
  const canSendToLab = actions.some((a) => a.kind === "lab");
  const canCancel = actions.some((a) => a.kind === "cancel");

  const onLabSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendToLab.isPending) return;
    const result = validateLabOrder(labText);
    if (!result.ok) {
      setLabError(result.error);
      return;
    }
    sendToLab.mutate(result.value, {
      onSuccess: () => {
        setLabOpen(false);
        setLabText("");
      },
    });
  };

  const addLabTest = (name: string) => {
    if (!name) return;
    setLabText((text) => {
      const lines = text.split(/\r?\n/).map((l) => l.trim().toLowerCase());
      if (lines.includes(name.trim().toLowerCase())) return text;
      return text.trim() === "" ? name : `${text.replace(/\s+$/, "")}\n${name}`;
    });
    setLabError(null);
  };

  const onCancelSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (transition.isPending) return;
    const result = validateCancelReason(reason);
    if (!result.ok) {
      setReasonError(result.error);
      return;
    }
    transition.mutate(
      { toStatus: "CANCELLED", reason: result.reason },
      {
        onSuccess: () => {
          setCancelling(false);
          setReason("");
        },
      }
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Actions</h2>

      {transition.isError && <MutationError error={transition.error} />}
      {sendToLab.isError && <MutationError error={sendToLab.error} />}

      {sendActions.length > 0 && !cancelling && !labOpen && (
        <div className="flex flex-wrap gap-2">
          {sendActions.map((action) => (
            <button
              key={action.toStatus}
              type="button"
              disabled={transition.isPending}
              onClick={() => transition.mutate({ toStatus: action.toStatus })}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {transition.isPending && transition.variables?.toStatus === action.toStatus ? "Sending…" : action.label}
            </button>
          ))}
          {canSendToLab && (
            <button
              type="button"
              disabled={transition.isPending}
              onClick={() => {
                sendToLab.reset();
                setLabOpen(true);
              }}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Send to lab…
            </button>
          )}
        </div>
      )}

      {labOpen && (
        <form onSubmit={onLabSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="direct-lab-tests" className="text-sm font-medium text-slate-700">
              Lab tests * <span className="font-normal text-slate-500">(one per line)</span>
            </label>
            {priceList.data && (
              <select
                aria-label="Add a test from the price list"
                value=""
                onChange={(e) => addLabTest(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Add from price list…</option>
                {activePriceListItems(priceList.data).map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
            <textarea
              id="direct-lab-tests"
              rows={4}
              value={labText}
              placeholder={"Malaria RDT\nCBC"}
              onChange={(e) => {
                setLabText(e.target.value);
                setLabError(null);
              }}
              aria-invalid={labError ? true : undefined}
              className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
            />
            {labError && <p className="mt-1 text-xs text-red-700">{labError}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={sendToLab.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {sendToLab.isPending ? "Sending…" : "Send to lab"}
            </button>
            <button
              type="button"
              disabled={sendToLab.isPending}
              onClick={() => {
                setLabOpen(false);
                setLabError(null);
                sendToLab.reset();
              }}
              className="text-sm text-slate-600 hover:underline"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {canCancel && !cancelling && !labOpen && (
        <button
          type="button"
          disabled={transition.isPending}
          onClick={() => {
            transition.reset();
            setCancelling(true);
          }}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Cancel visit…
        </button>
      )}

      {cancelling && (
        <form onSubmit={onCancelSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="cancel-reason" className="text-sm font-medium text-slate-700">
              Reason for cancelling *
            </label>
            <textarea
              id="cancel-reason"
              autoFocus
              rows={3}
              maxLength={CANCEL_REASON_MAX}
              value={reason}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? "cancel-reason-error" : undefined}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError(null);
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
            />
            {reasonError && (
              <p id="cancel-reason-error" className="mt-1 text-xs text-red-700">
                {reasonError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={transition.isPending}
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {transition.isPending ? "Cancelling…" : "Cancel this visit"}
            </button>
            <button
              type="button"
              disabled={transition.isPending}
              onClick={() => {
                setCancelling(false);
                setReason("");
                setReasonError(null);
                transition.reset();
              }}
              className="text-sm text-slate-600 hover:underline"
            >
              Keep visit
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
