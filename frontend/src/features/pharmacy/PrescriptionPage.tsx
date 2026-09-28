import { useState } from "react";
import { Link, useParams } from "react-router";
import { isApiError } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useVisitPrescriptions } from "../doctor/queries";
import { useInventory } from "../inventory/queries";
import { useVisit } from "../visits/queries";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { DispensePanel } from "./DispensePanel";
import { remainingQuantity } from "./dispenseForm";
import { pendingItems, parseIncompleteDispensing } from "./pendingItems";
import { allowedPharmacyActions } from "./pharmacyActions";
import { pharmacyErrorMessage } from "./pharmacyErrors";
import { usePrescription, usePrescriptionMutations, useStartPharmacy } from "./queries";

const STATUS_LABELS = {
  PENDING: "Not dispensed",
  PARTIALLY_DISPENSED: "Partly dispensed",
  DISPENSED: "Dispensed",
  UNAVAILABLE: "Unavailable",
} as const;

/**
 * One prescription. Loads the prescription, then its visit, then every
 * prescription on the visit (completing is visit-wide) and the stock list.
 */
export function PrescriptionPage() {
  const { prescriptionId = "" } = useParams();
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";

  const prescriptionQuery = usePrescription(prescriptionId);
  const visitId = prescriptionQuery.data?.visitId ?? "";
  const visitQuery = useVisit(visitId, prescriptionQuery.isSuccess);
  const visitPrescriptions = useVisitPrescriptions(visitId, visitQuery.isSuccess);
  const inventory = useInventory(visitQuery.isSuccess);
  const start = useStartPharmacy();
  const { dispense, complete } = usePrescriptionMutations(prescriptionId, visitId);
  const [formDirty, setFormDirty] = useState(false);

  if (prescriptionQuery.isPending) return <LoadingState label="Loading prescription…" />;
  if (prescriptionQuery.isError) {
    return (
      <ErrorState
        error={prescriptionQuery.error}
        notFound="This prescription does not exist."
        onRetry={() => void prescriptionQuery.refetch()}
      />
    );
  }
  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />;
  }

  const prescription = prescriptionQuery.data;
  const { visit } = visitQuery.data;
  const actions = allowedPharmacyActions(role, visit.status);
  // inventoryItemId → stock name. Never a guess: "Loading…" until the list arrives, "Unknown stock item" if absent.
  const stockName = (id: string | null) => {
    if (!id) return null;
    if (!inventory.isSuccess) return inventory.isError ? "Unknown stock item" : "Loading…";
    return inventory.data.find((s) => s.id === id)?.name ?? "Unknown stock item";
  };
  const pending = visitPrescriptions.isSuccess ? pendingItems(visitPrescriptions.data) : [];
  const pendingCount = pending.reduce((n, p) => n + p.medicineNames.length, 0);
  const others = visitPrescriptions.isSuccess ? visitPrescriptions.data.filter((p) => p.id !== prescription.id) : [];

  const incomplete =
    complete.isError && isApiError(complete.error) && complete.error.code === "INCOMPLETE_DISPENSING"
      ? parseIncompleteDispensing(
          complete.error.message,
          prescription.id,
          pending.flatMap((p) => p.medicineNames.map((medicineName) => ({ prescriptionId: p.prescriptionId, medicineName })))
        )
      : null;

  return (
    <section className="space-y-6">
      <div>
        <Link to="/pharmacy/queue" className="text-sm text-slate-600 hover:underline">
          ← Pharmacy queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Prescription — {visit.patientFullName}</h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Prescribed by {prescription.doctorName}, {formatDateTime(prescription.createdAt)}
        </p>
      </div>

      {complete.isSuccess && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Pharmacy complete. The patient is now waiting for billing.{" "}
          <Link to="/pharmacy/queue" className="font-medium underline">
            Back to the pharmacy queue
          </Link>
        </div>
      )}

      {actions.canStart && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            This patient is waiting for the pharmacy. Starting moves the visit to “At pharmacy” for all its prescriptions.
          </p>
          {start.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {pharmacyErrorMessage(start.error)}
            </p>
          )}
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => start.mutate(prescription)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {start.isPending ? "Starting…" : "Start dispensing"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Medicines</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Medicine</th>
                <th className="px-3 py-2">Prescribed</th>
                <th className="px-3 py-2">Dispensed</th>
                <th className="px-3 py-2">Remaining</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">From stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prescription.items.map((item) => {
                const remaining = remainingQuantity(item);
                return (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{item.medicineName}</p>
                      <p className="text-xs text-slate-500">
                        {[item.strength, item.dosage, item.frequency, item.duration].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2">{item.quantityPrescribed ?? "not set"}</td>
                    <td className="px-3 py-2">{item.quantityDispensed ?? 0}</td>
                    <td className="px-3 py-2">{remaining === null ? "—" : remaining}</td>
                    <td className="px-3 py-2">{STATUS_LABELS[item.status]}</td>
                    <td className="px-3 py-2 text-slate-600">{stockName(item.inventoryItemId) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {actions.canDispense && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Dispense</h2>
          {inventory.isPending ? (
            <LoadingState label="Loading stock…" />
          ) : inventory.isError ? (
            <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />
          ) : (
            <DispensePanel
              key={prescription.items.map((i) => `${i.id}:${i.status}:${i.quantityDispensed ?? 0}`).join("|")}
              prescription={prescription}
              inventory={inventory.data}
              mutation={dispense}
              onDirtyChange={setFormDirty}
            />
          )}
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">This visit’s prescriptions</h2>
        {visitPrescriptions.isPending ? (
          <LoadingState label="Loading the visit’s prescriptions…" />
        ) : visitPrescriptions.isError ? (
          <ErrorState error={visitPrescriptions.error} onRetry={() => void visitPrescriptions.refetch()} />
        ) : (
          <>
            {others.length === 0 ? (
              <p className="text-sm text-slate-700">This is the visit’s only prescription.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {others.map((p) => (
                  <li key={p.id}>
                    Also on this visit:{" "}
                    <Link to={`/pharmacy/prescriptions/${p.id}`} className="font-medium text-slate-900 underline">
                      {p.items.map((i) => i.medicineName).join(", ")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {pending.length === 0 ? (
              <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
                No medicine on this visit is still waiting to be dispensed.
              </p>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">
                  {pendingCount === 1 ? "1 medicine" : `${pendingCount} medicines`} not yet dispensed or marked
                  unavailable:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {pending.map((p) => (
                    <li key={p.prescriptionId}>
                      {p.prescriptionId === prescription.id ? (
                        <>This prescription: {p.medicineNames.join(", ")}</>
                      ) : (
                        <>
                          <Link to={`/pharmacy/prescriptions/${p.prescriptionId}`} className="underline">
                            Prescription from {formatDateTime(p.createdAt)}
                          </Link>
                          : {p.medicineNames.join(", ")}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {actions.canComplete && (
          <>
            <p className="text-sm text-slate-700">
              Completing finishes the pharmacy step for the whole visit and sends the patient to billing. Every medicine
              must be dispensed (fully or partly) or marked unavailable first.
            </p>
            {formDirty && (
              <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                You have unsaved dispensing choices. Save or clear them before completing.
              </p>
            )}
            {complete.isError &&
              (incomplete ? (
                <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-medium">Pharmacy can’t be completed yet. Still pending:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {incomplete.map((m) => (
                      <li key={`${m.prescriptionId}-${m.medicineName}`}>
                        {m.medicineName}
                        {m.prescriptionId !== prescription.id && (
                          <>
                            {" "}
                            (
                            <Link to={`/pharmacy/prescriptions/${m.prescriptionId}`} className="underline">
                              another prescription
                            </Link>
                            )
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {isApiError(complete.error) && complete.error.code === "INCOMPLETE_DISPENSING"
                    ? complete.error.message
                    : pharmacyErrorMessage(complete.error)}
                </p>
              ))}
            <button
              type="button"
              onClick={() => complete.mutate()}
              disabled={complete.isPending || !visitPrescriptions.isSuccess || pending.length > 0 || formDirty}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {complete.isPending ? "Completing…" : "Complete pharmacy"}
            </button>
          </>
        )}
      </div>

      {prescription.items.length === 0 && <EmptyState>This prescription has no medicines.</EmptyState>}
    </section>
  );
}
