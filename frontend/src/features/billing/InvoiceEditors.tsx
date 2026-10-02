import { useState, type FormEvent } from "react";
import { usePriceList } from "../priceList/queries";
import { writeFailureOutcome, billingErrorMessage } from "./billingErrors";
import {
  DESCRIPTION_MAX,
  EMPTY_ITEM_ROW,
  INVOICE_ITEMS_MAX,
  lineTotalCents,
  validateInvoiceItems,
  validatePayment,
  type ItemRow,
  type ItemRowErrors,
  type PaymentErrors,
} from "./invoiceForms";
import { centsToAmount, formatMoney } from "./money";
import { activePriceListItems, fillRowFromPriceListItem, priceListOptionLabel } from "./priceListPick";
import type { useInvoiceMutations } from "./queries";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "./types";

type Mutations = ReturnType<typeof useInvoiceMutations>;

const inputClass =
  "mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";
const primaryButton =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

/**
 * POST /billing/invoices/:id/items — one or more charges at once. Each row
 * can be filled from an active price-list item (GET /price-list) or typed
 * in freely; either way it is an ordinary row, validated and sent the same.
 */
export function AddItemsForm({ mutation }: { mutation: Mutations["addItems"] }) {
  const [rows, setRows] = useState<ItemRow[]>([EMPTY_ITEM_ROW]);
  const [rowErrors, setRowErrors] = useState<ItemRowErrors[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The price-list item each row was last filled from ("" = typed in). Cleared when the description or price is edited.
  const [picked, setPicked] = useState<string[]>([""]);
  const priceList = usePriceList();
  const priceListOptions = priceList.isSuccess ? activePriceListItems(priceList.data) : [];

  const setField = (index: number, key: keyof ItemRow, value: string) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    setRowErrors((es) => es.map((e, i) => (i === index ? { ...e, [key]: undefined } : e)));
    if (key !== "quantity") setPicked((ps) => ps.map((p, i) => (i === index ? "" : p)));
    setError(null);
  };

  const pickPriceListItem = (index: number, itemId: string) => {
    const item = priceListOptions.find((p) => p.id === itemId);
    setPicked((ps) => ps.map((p, i) => (i === index ? (item ? item.id : "") : p)));
    if (!item) return;
    setRows((rs) => rs.map((r, i) => (i === index ? fillRowFromPriceListItem(r, item) : r)));
    setRowErrors((es) => es.map((e, i) => (i === index ? { ...e, description: undefined, unitPrice: undefined } : e)));
    setError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateInvoiceItems(rows);
    if (!result.ok) {
      setRowErrors(result.rowErrors);
      setError(result.error ?? null);
      return;
    }
    mutation.mutate(result.items, {
      onSuccess: () => {
        setRows([EMPTY_ITEM_ROW]);
        setRowErrors([]);
        setPicked([""]);
      },
    });
  };

  const previewCents = rows.reduce((sum, r) => sum + (lineTotalCents(r) ?? 0), 0);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Add charges</h3>
      {priceList.isError && (
        <p className="text-xs text-slate-600">
          Couldn’t load the price list — charges can still be typed in.{" "}
          <button type="button" onClick={() => void priceList.refetch()} className="underline">
            Try again
          </button>
        </p>
      )}
      {rows.map((row, index) => {
        const errors = rowErrors[index] ?? {};
        const line = lineTotalCents(row);
        const pickedId = priceListOptions.some((p) => p.id === picked[index]) ? picked[index] : "";
        return (
          <div key={index} className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-12">
            <div className="sm:col-span-12">
              <label htmlFor={`charge-${index}-priceList`} className="text-xs font-medium text-slate-600">
                From price list (optional)
              </label>
              <select
                id={`charge-${index}-priceList`}
                value={pickedId}
                disabled={priceListOptions.length === 0}
                onChange={(e) => pickPriceListItem(index, e.target.value)}
                className={inputClass}
              >
                <option value="">
                  {priceList.isPending
                    ? "Loading price list…"
                    : priceList.isError
                      ? "Price list unavailable"
                      : priceListOptions.length === 0
                        ? "No price list items"
                        : "Choose an item, or type the charge below…"}
                </option>
                {priceListOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {priceListOptionLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-6">
              <label htmlFor={`charge-${index}-description`} className="text-xs font-medium text-slate-600">
                Description
              </label>
              <input
                id={`charge-${index}-description`}
                maxLength={DESCRIPTION_MAX}
                value={row.description}
                onChange={(e) => setField(index, "description", e.target.value)}
                aria-invalid={errors.description ? true : undefined}
                className={inputClass}
              />
              {errors.description && <p className="mt-0.5 text-xs text-red-700">{errors.description}</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`charge-${index}-quantity`} className="text-xs font-medium text-slate-600">
                Qty
              </label>
              <input
                id={`charge-${index}-quantity`}
                inputMode="numeric"
                value={row.quantity}
                onChange={(e) => setField(index, "quantity", e.target.value)}
                aria-invalid={errors.quantity ? true : undefined}
                className={inputClass}
              />
              {errors.quantity && <p className="mt-0.5 text-xs text-red-700">{errors.quantity}</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`charge-${index}-unitPrice`} className="text-xs font-medium text-slate-600">
                Unit price
              </label>
              <input
                id={`charge-${index}-unitPrice`}
                inputMode="decimal"
                value={row.unitPrice}
                onChange={(e) => setField(index, "unitPrice", e.target.value)}
                aria-invalid={errors.unitPrice ? true : undefined}
                className={inputClass}
              />
              {errors.unitPrice && <p className="mt-0.5 text-xs text-red-700">{errors.unitPrice}</p>}
            </div>
            <div className="flex items-end justify-between gap-2 text-sm sm:col-span-2">
              <span className="tabular-nums text-slate-700">{line === null ? "—" : formatMoney(centsToAmount(line))}</span>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setRows((rs) => rs.filter((_, i) => i !== index));
                    setRowErrors((es) => es.filter((_, i) => i !== index));
                    setPicked((ps) => ps.filter((_, i) => i !== index));
                  }}
                  className="text-xs text-slate-600 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        );
      })}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {mutation.isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {billingErrorMessage(mutation.error)}
          {writeFailureOutcome(mutation.error) === "unknown" &&
            " It could not be confirmed whether the charges were added — check the invoice below before adding them again."}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={rows.length >= INVOICE_ITEMS_MAX}
          onClick={() => {
            setRows((rs) => [...rs, EMPTY_ITEM_ROW]);
            setPicked((ps) => [...ps, ""]);
          }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Add another charge
        </button>
        <button type="submit" disabled={mutation.isPending} className={primaryButton}>
          {mutation.isPending ? "Adding…" : "Add to invoice"}
        </button>
        {previewCents > 0 && (
          <span className="text-sm text-slate-600">Adds {formatMoney(centsToAmount(previewCents))}</span>
        )}
      </div>
    </form>
  );
}

/** POST /billing/invoices/:id/payments — never more than the current balance. */
export function PaymentForm({ mutation, balance }: { mutation: Mutations["pay"]; balance: number }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [errors, setErrors] = useState<PaymentErrors>({});

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validatePayment(amount, method, balance);
    if (!result.ok) return setErrors(result.errors);
    mutation.mutate(result.body, {
      onSuccess: () => {
        setAmount("");
        setMethod("");
        setErrors({});
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Record a payment</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="payment-amount" className="text-xs font-medium text-slate-600">
            Amount (balance {formatMoney(balance)})
          </label>
          <input
            id="payment-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setErrors((er) => ({ ...er, amount: undefined }));
            }}
            aria-invalid={errors.amount ? true : undefined}
            className={inputClass}
          />
          {errors.amount && <p className="mt-0.5 text-xs text-red-700">{errors.amount}</p>}
          <button
            type="button"
            onClick={() => {
              setAmount(balance.toFixed(2));
              setErrors((er) => ({ ...er, amount: undefined }));
            }}
            className="mt-1 text-xs font-medium text-slate-700 underline"
          >
            Pay the full balance
          </button>
        </div>
        <div>
          <label htmlFor="payment-method" className="text-xs font-medium text-slate-600">
            Method
          </label>
          <select
            id="payment-method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as PaymentMethod | "");
              setErrors((er) => ({ ...er, method: undefined }));
            }}
            aria-invalid={errors.method ? true : undefined}
            className={inputClass}
          >
            <option value="">Choose…</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {errors.method && <p className="mt-0.5 text-xs text-red-700">{errors.method}</p>}
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={mutation.isPending} className={primaryButton}>
            {mutation.isPending ? "Recording…" : "Record payment"}
          </button>
        </div>
      </div>
      {mutation.isError &&
        (writeFailureOutcome(mutation.error) === "not-saved" ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            The payment was not recorded. {billingErrorMessage(mutation.error)}
          </p>
        ) : (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            It could not be confirmed whether the payment was recorded. {billingErrorMessage(mutation.error)} Check the
            payments list below before recording it again, so the patient is not charged twice.
          </p>
        ))}
    </form>
  );
}
