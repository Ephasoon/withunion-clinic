import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { isApiError, validationDetails } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useVisitLabOrders } from "../doctor/queries";
import type { LabOrderDetail } from "../doctor/types";
import { useVisit } from "../visits/queries";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { allowedLabActions } from "./labActions";
import { labErrorMessage } from "./labErrors";
import { missingResults, ordersInRound, parseIncompleteResults } from "./missingResults";
import { useLabOrder, useLabOrderMutations, useStartLabOrder } from "./queries";
import { hasUnsavedResults, RESULT_MAX, resultsFormFrom, validateResultsForm } from "./resultsForm";

type Mutations = ReturnType<typeof useLabOrderMutations>;

function ResultsForm({
  order,
  saveResults,
  onDirtyChange,
}: {
  order: LabOrderDetail;
  saveResults: Mutations["saveResults"];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [values, setValues] = useState(() => resultsFormFrom(order.items));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => onDirtyChange(hasUnsavedResults(order.items, values)), [order.items, values, onDirtyChange]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveResults.isPending) return;
    const result = validateResultsForm(order.items, values);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(result.error ?? null);
      return;
    }
    saveResults.mutate(result.results, {
      onError: (error) => {
        // Zod keys array errors by the top-level field ("results"), so show them on the form.
        const details = validationDetails(error);
        if (details?.results?.[0]) setFormError(details.results[0]);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        Enter results as they come in. Saved results can be corrected until the lab round is completed.
      </p>
      {order.items.map((item) => {
        const saved = (item.result ?? "").trim();
        const changed = (values[item.id] ?? "").trim() !== saved;
        return (
          <div key={item.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={`result-${item.id}`} className="text-sm font-medium text-slate-900">
                {item.testName}
              </label>
              <span className={`text-xs ${changed ? "text-amber-700" : saved ? "text-green-700" : "text-slate-500"}`}>
                {changed ? "Unsaved" : saved ? `Saved ${item.resultEnteredAt ? formatDateTime(item.resultEnteredAt) : ""}` : "No result yet"}
              </span>
            </div>
            <textarea
              id={`result-${item.id}`}
              rows={2}
              maxLength={RESULT_MAX}
              value={values[item.id] ?? ""}
              onChange={(e) => {
                setValues((v) => ({ ...v, [item.id]: e.target.value }));
                setErrors((er) => ({ ...er, [item.id]: "" }));
                setFormError(null);
              }}
              aria-invalid={errors[item.id] ? true : undefined}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
            />
            {errors[item.id] && <p className="mt-1 text-xs text-red-700">{errors[item.id]}</p>}
          </div>
        );
      })}
      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      )}
      {saveResults.isError && !formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {labErrorMessage(saveResults.error)}
        </p>
      )}
      <button
        type="submit"
        disabled={saveResults.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {saveResults.isPending ? "Saving…" : "Save results"}
      </button>
    </form>
  );
}

function ResultsReadOnly({ order }: { order: LabOrderDetail }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {order.items.map((item) => (
        <li key={item.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
          <span className="font-medium text-slate-900">{item.testName}</span>
          <span className={item.result ? "whitespace-pre-wrap text-slate-800" : "text-slate-400"}>
            {item.result ?? "No result yet"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One lab order. Loads the order, then its visit, then every lab order on
 * the visit (the round that completing will close).
 */
export function LabOrderPage() {
  const { orderId = "" } = useParams();
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";

  const orderQuery = useLabOrder(orderId);
  const visitId = orderQuery.data?.visitId ?? "";
  const visitQuery = useVisit(visitId, orderQuery.isSuccess);
  const roundQuery = useVisitLabOrders(visitId, visitQuery.isSuccess);
  const start = useStartLabOrder();
  const { saveResults, complete } = useLabOrderMutations(orderId, visitId);
  const [resultsDirty, setResultsDirty] = useState(false);

  if (orderQuery.isPending) return <LoadingState label="Loading lab order…" />;
  if (orderQuery.isError) {
    return <ErrorState error={orderQuery.error} notFound="This lab order does not exist." onRetry={() => void orderQuery.refetch()} />;
  }
  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />;
  }

  const order = orderQuery.data;
  const { visit } = visitQuery.data;
  const actions = allowedLabActions(role, visit.status, order.status);
  const round = roundQuery.isSuccess ? ordersInRound(roundQuery.data) : [];
  const missing = roundQuery.isSuccess ? missingResults(roundQuery.data) : [];
  const missingCount = missing.reduce((n, m) => n + m.testNames.length, 0);
  const otherOrders = round.filter((o) => o.id !== order.id);

  const incomplete =
    complete.isError && isApiError(complete.error) && complete.error.code === "INCOMPLETE_RESULTS"
      ? parseIncompleteResults(
          complete.error.message,
          order.id,
          round.flatMap((o) => o.items.map((i) => ({ orderId: o.id, testName: i.testName })))
        )
      : null;

  return (
    <section className="space-y-6">
      <div>
        <Link to="/laboratory/queue" className="text-sm text-slate-600 hover:underline">
          ← Lab queue
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Lab order — {visit.patientFullName}</h1>
          <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
          <VisitStatusBadge status={visit.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Ordered {formatDateTime(order.requestedAt)} by {order.requestedByName} ·{" "}
          {order.status === "REQUESTED" ? "outstanding" : "completed"}
        </p>
      </div>

      {complete.isSuccess && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Lab round completed. The results are with the doctor and the patient is back in the doctor’s queue.{" "}
          <Link to="/laboratory/queue" className="font-medium underline">
            Back to the lab queue
          </Link>
        </div>
      )}

      {actions.canStart && (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700">
            This patient is waiting for the lab. Starting moves the visit to “At lab” for all of its outstanding orders.
          </p>
          {start.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {labErrorMessage(start.error)}
            </p>
          )}
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => start.mutate(order)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {start.isPending ? "Starting…" : "Start lab work"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Results</h2>
        {actions.canEnterResults ? (
          <ResultsForm
            key={order.items.map((i) => `${i.id}:${i.result ?? ""}`).join("|")}
            order={order}
            saveResults={saveResults}
            onDirtyChange={setResultsDirty}
          />
        ) : (
          <ResultsReadOnly order={order} />
        )}
      </div>

      {order.status === "REQUESTED" && (
        <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">This lab round</h2>
          {roundQuery.isPending ? (
            <LoadingState label="Loading the visit’s lab orders…" />
          ) : roundQuery.isError ? (
            <ErrorState error={roundQuery.error} onRetry={() => void roundQuery.refetch()} />
          ) : round.length === 0 ? (
            <EmptyState>No outstanding orders on this visit.</EmptyState>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                Completing closes all {round.length} outstanding {round.length === 1 ? "order" : "orders"} on this visit
                and sends the patient back to the doctor. Every test needs a result first.
              </p>
              {otherOrders.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {otherOrders.map((o) => (
                    <li key={o.id}>
                      Also in this round:{" "}
                      <Link to={`/laboratory/orders/${o.id}`} className="font-medium text-slate-900 underline">
                        {o.items.map((i) => i.testName).join(", ")}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {missing.length === 0 ? (
                <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">Every test has a result.</p>
              ) : (
                <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">
                    {missingCount === 1 ? "1 test still needs a result:" : `${missingCount} tests still need results:`}
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {missing.map((m) => (
                      <li key={m.orderId}>
                        {m.orderId === order.id ? (
                          <>This order: {m.testNames.join(", ")}</>
                        ) : (
                          <>
                            <Link to={`/laboratory/orders/${m.orderId}`} className="underline">
                              Order from {formatDateTime(m.requestedAt)}
                            </Link>
                            : {m.testNames.join(", ")}
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
              {resultsDirty && (
                <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  You have unsaved results. Save them before completing.
                </p>
              )}
              {complete.isError &&
                (incomplete ? (
                  <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-medium">The round can’t be completed yet. Missing results:</p>
                    <ul className="mt-1 list-disc pl-5">
                      {incomplete.map((t) => (
                        <li key={`${t.orderId}-${t.testName}`}>
                          {t.testName}
                          {t.orderId !== order.id && (
                            <>
                              {" "}
                              (
                              <Link to={`/laboratory/orders/${t.orderId}`} className="underline">
                                another order
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
                    {isApiError(complete.error) && complete.error.code === "INCOMPLETE_RESULTS"
                      ? complete.error.message
                      : labErrorMessage(complete.error)}
                  </p>
                ))}
              <button
                type="button"
                onClick={() => complete.mutate()}
                disabled={complete.isPending || !roundQuery.isSuccess || missing.length > 0 || resultsDirty}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {complete.isPending ? "Completing…" : "Complete lab round"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
