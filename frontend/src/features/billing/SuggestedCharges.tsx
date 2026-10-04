import { useState } from "react";
import { isApiError } from "../../api";
import { EmptyState, LoadingState } from "../../components/QueryStates";
import { describeApiError } from "../../lib/errorMessages";
import { useVisitLabOrders, useVisitPrescriptions } from "../doctor/queries";
import { usePriceList } from "../priceList/queries";
import { billingErrorMessage, writeFailureOutcome } from "./billingErrors";
import { addAllItems, buildChargeSuggestions, suggestionToInvoiceItem, type ChargeSuggestion } from "./chargeSuggestions";
import { INVOICE_ITEMS_MAX } from "./invoiceForms";
import { centsToAmount, formatMoney } from "./money";
import { activePriceListItems, priceListOptionLabel } from "./priceListPick";
import { useChargeLinks, useSaveChargeLink, type useAddInvoiceItems } from "./queries";
import type { InvoiceDetail } from "./types";

const primaryButton =
  "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const secondaryButton =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50";

const KIND_LABELS: Record<ChargeSuggestion["kind"], string> = { medicine: "Medicine", lab: "Lab test" };

function saveLinkErrorMessage(error: unknown): string {
  if (isApiError(error) && error.code === "PRICE_LIST_ITEM_INACTIVE") {
    return "That price-list item has just been deactivated. The list has been refreshed — choose another.";
  }
  if (isApiError(error) && error.code === "NOT_FOUND") return "That price-list item no longer exists. Choose another.";
  return describeApiError(error);
}

/**
 * Charges suggested from this visit's dispensed medicines and completed
 * lab tests (see buildChargeSuggestions), priced from the price list via
 * saved links (GET/PUT /charge-links). Nothing is added without a click:
 * Add / Add all go through the ordinary POST /billing/invoices/:id/items.
 * Confirming a "please confirm" match, or choosing a price for an
 * unmatched row, saves a link so the name is linked next time. Render only
 * while the invoice is OPEN and the user may add items. If anything here
 * fails to load, the "Add charges" form below works as before.
 */
export function SuggestedCharges({
  visitId,
  invoice,
  mutation,
}: {
  visitId: string;
  invoice: InvoiceDetail;
  mutation: ReturnType<typeof useAddInvoiceItems>;
}) {
  const prescriptions = useVisitPrescriptions(visitId, true);
  const labOrders = useVisitLabOrders(visitId, true);
  const priceList = usePriceList();
  const links = useChargeLinks(true);
  const saveLink = useSaveChargeLink();
  // The price chosen in each unmatched row's dropdown, by row key.
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const queries = [prescriptions, labOrders, priceList, links];

  let body;
  if (queries.some((q) => q.isError)) {
    body = (
      <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p>Couldn’t load suggested charges. You can still add charges by hand below.</p>
        <button
          type="button"
          onClick={() => queries.filter((q) => q.isError).forEach((q) => void q.refetch())}
          className="mt-1 font-medium text-red-900 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  } else if (!prescriptions.isSuccess || !labOrders.isSuccess || !priceList.isSuccess || !links.isSuccess) {
    body = <LoadingState label="Loading suggested charges…" />;
  } else {
    const suggestions = buildChargeSuggestions({
      prescriptions: prescriptions.data,
      labOrders: labOrders.data,
      priceList: priceList.data,
      links: links.data,
      invoiceItems: invoice.items,
    });
    const options = activePriceListItems(priceList.data);
    const addAll = addAllItems(suggestions);
    const busy = mutation.isPending || saveLink.isPending;

    const save = (suggestion: ChargeSuggestion, priceListItemId: string) =>
      saveLink.mutate(
        { name: suggestion.name, priceListItemId },
        {
          onSuccess: () => setChosen((c) => ({ ...c, [suggestion.key]: "" })),
          onError: (error) => {
            if (isApiError(error) && error.code === "PRICE_LIST_ITEM_INACTIVE") void priceList.refetch();
          },
        }
      );
    const add = (suggestion: ChargeSuggestion) => {
      const item = suggestionToInvoiceItem(suggestion);
      if (item) mutation.mutate([item]);
    };

    body =
      suggestions.length === 0 ? (
        <EmptyState>
          Nothing to suggest — no dispensed medicines or completed lab tests that aren’t already on the invoice.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {suggestions.map((s) => {
              const savingThis = saveLink.isPending && saveLink.variables?.name === s.name;
              return (
                <li key={s.key} className="space-y-2 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-900">{s.name}</span>{" "}
                      <span className="text-xs text-slate-500">
                        {KIND_LABELS[s.kind]} · qty {s.quantity}
                      </span>
                    </div>
                    <span className="tabular-nums text-slate-700">
                      {s.lineTotalCents === null ? "—" : formatMoney(centsToAmount(s.lineTotalCents))}
                    </span>
                  </div>

                  {s.state !== "unmatched" && s.priceListItem && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-700">
                        {priceListOptionLabel(s.priceListItem)} × {s.quantity}
                      </span>
                      {s.state === "confirm" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                          Please confirm
                        </span>
                      )}
                      <span className="ml-auto flex gap-2">
                        {s.state === "confirm" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => save(s, s.priceListItem!.id)}
                            className={secondaryButton}
                          >
                            {savingThis ? "Saving…" : "Confirm match"}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy || s.state !== "linked"}
                          title={s.state === "confirm" ? "Confirm the match first" : undefined}
                          onClick={() => add(s)}
                          className={primaryButton}
                        >
                          Add
                        </button>
                      </span>
                    </div>
                  )}

                  {s.state === "unmatched" && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-48 flex-1">
                        <label htmlFor={`suggest-${s.key}`} className="text-xs font-medium text-slate-600">
                          Choose a price
                        </label>
                        <select
                          id={`suggest-${s.key}`}
                          value={chosen[s.key] ?? ""}
                          disabled={options.length === 0 || busy}
                          onChange={(e) => setChosen((c) => ({ ...c, [s.key]: e.target.value }))}
                          className="mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                        >
                          <option value="">{options.length === 0 ? "No price list items" : "Choose an item…"}</option>
                          {options.map((p) => (
                            <option key={p.id} value={p.id}>
                              {priceListOptionLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        disabled={busy || !chosen[s.key]}
                        onClick={() => save(s, chosen[s.key]!)}
                        className={secondaryButton}
                      >
                        {savingThis ? "Saving…" : "Use this price"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {saveLink.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              The match was not saved. {saveLinkErrorMessage(saveLink.error)}
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {billingErrorMessage(mutation.error)}
              {writeFailureOutcome(mutation.error) === "unknown" &&
                " It could not be confirmed whether the charges were added — check the invoice above before adding them again."}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || addAll.length === 0 || addAll.length > INVOICE_ITEMS_MAX}
              onClick={() => mutation.mutate(addAll)}
              className={primaryButton}
            >
              {mutation.isPending ? "Adding…" : `Add all linked (${addAll.length})`}
            </button>
            <span className="text-xs text-slate-600">
              {addAll.length > INVOICE_ITEMS_MAX
                ? `More than ${INVOICE_ITEMS_MAX} rows — add them one at a time.`
                : "Adds only rows with a saved price. Rows to confirm or price are never added automatically."}
            </span>
          </div>
        </div>
      );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Suggested charges</h2>
      {body}
    </div>
  );
}
