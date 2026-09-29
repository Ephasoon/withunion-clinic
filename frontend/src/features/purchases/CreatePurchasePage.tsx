import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { todayIsoDate } from "../../lib/dates";
import { useInventory } from "../inventory/queries";
import { useSuppliers } from "../suppliers/queries";
import { createPurchaseErrorMessage } from "./purchaseErrors";
import {
  buildCreatePurchase,
  draftTotalCents,
  formatCents,
  isBlankRow,
  PURCHASE_LIMITS,
  type PurchaseFormErrors,
  type PurchaseFormValues,
  type PurchaseItemRow,
} from "./purchaseForm";
import { useCreatePurchase } from "./queries";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

const NO_ERRORS: PurchaseFormErrors = { rows: {} };

/** POST /purchases. Saved as PENDING; stock changes only when the purchase is received. */
export function CreatePurchasePage() {
  const navigate = useNavigate();
  const suppliers = useSuppliers();
  const inventory = useInventory();
  const create = useCreatePurchase();
  const nextKey = useRef(1);
  const newRow = (): PurchaseItemRow => ({ key: `row-${nextKey.current++}`, inventoryItemId: "", quantity: "", unitCost: "" });

  const [values, setValues] = useState<PurchaseFormValues>(() => ({
    supplierId: "",
    purchaseDate: todayIsoDate(),
    referenceNumber: "",
    notes: "",
    items: [newRow()],
  }));
  const [errors, setErrors] = useState<PurchaseFormErrors>(NO_ERRORS);
  const [serverError, setServerError] = useState<string | null>(null);

  const itemNames = useMemo(() => new Map((inventory.data ?? []).map((i) => [i.id, i.name])), [inventory.data]);

  if (suppliers.isPending || inventory.isPending) return <LoadingState label="Loading suppliers and stock…" />;
  if (suppliers.isError) return <ErrorState error={suppliers.error} onRetry={() => void suppliers.refetch()} />;
  if (inventory.isError) return <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />;

  const setField = (key: "supplierId" | "purchaseDate" | "referenceNumber" | "notes", value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setServerError(null);
  };

  const setRow = (key: string, field: "inventoryItemId" | "quantity" | "unitCost", value: string) => {
    setValues((v) => ({ ...v, items: v.items.map((r) => (r.key === key ? { ...r, [field]: value } : r)) }));
    setErrors((e) => ({ ...e, items: undefined, rows: { ...e.rows, [key]: { ...e.rows[key], [field]: undefined } } }));
    setServerError(null);
  };

  const addRow = () => setValues((v) => (v.items.length >= PURCHASE_LIMITS.maxItems ? v : { ...v, items: [...v.items, newRow()] }));
  const removeRow = (key: string) => {
    setValues((v) => ({ ...v, items: v.items.length > 1 ? v.items.filter((r) => r.key !== key) : [newRow()] }));
    setErrors((e) => ({ ...e, items: undefined }));
    setServerError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = buildCreatePurchase(values);
    if (!result.ok) return setErrors(result.errors);
    setErrors(NO_ERRORS);
    create.mutate(result.body, {
      onSuccess: (purchase) => navigate(`/purchases/${purchase.id}`, { replace: true }),
      onError: (error) => setServerError(createPurchaseErrorMessage(error, itemNames)),
    });
  };

  const selectedSupplier = suppliers.data.find((s) => s.id === values.supplierId);
  const filledCount = values.items.filter((r) => !isBlankRow(r)).length;

  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link to="/purchases" className="text-sm text-slate-600 hover:underline">
          ← Purchases
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">New purchase</h1>
        <p className="text-sm text-slate-500">Saved as pending. Stock is added only when you mark the purchase as received.</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-lg border border-slate-200 bg-white p-6">
        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="purchase-supplier" className="text-sm font-medium text-slate-700">
              Supplier
            </label>
            <select id="purchase-supplier" value={values.supplierId} onChange={(e) => setField("supplierId", e.target.value)} aria-invalid={errors.supplierId ? true : undefined} className={inputClass}>
              <option value="">Choose a supplier…</option>
              {suppliers.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            {errors.supplierId ? (
              <p className="mt-1 text-xs text-red-700">{errors.supplierId}</p>
            ) : selectedSupplier && !selectedSupplier.isActive ? (
              <p className="mt-1 text-xs text-amber-800">This supplier is marked inactive. You can still record a purchase from them.</p>
            ) : suppliers.data.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                No suppliers yet — <Link to="/suppliers/new" className="underline">add one first</Link>.
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="purchase-date" className="text-sm font-medium text-slate-700">
              Purchase date
            </label>
            <input id="purchase-date" type="date" value={values.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} aria-invalid={errors.purchaseDate ? true : undefined} className={inputClass} />
            {errors.purchaseDate && <p className="mt-1 text-xs text-red-700">{errors.purchaseDate}</p>}
          </div>
          <div>
            <label htmlFor="purchase-reference" className="text-sm font-medium text-slate-700">
              Reference number (optional)
            </label>
            <input id="purchase-reference" maxLength={PURCHASE_LIMITS.referenceNumber} value={values.referenceNumber} onChange={(e) => setField("referenceNumber", e.target.value)} aria-invalid={errors.referenceNumber ? true : undefined} className={inputClass} />
            {errors.referenceNumber && <p className="mt-1 text-xs text-red-700">{errors.referenceNumber}</p>}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="purchase-notes" className="text-sm font-medium text-slate-700">
              Notes (optional)
            </label>
            <textarea id="purchase-notes" rows={2} maxLength={PURCHASE_LIMITS.notes} value={values.notes} onChange={(e) => setField("notes", e.target.value)} aria-invalid={errors.notes ? true : undefined} className={inputClass} />
            {errors.notes && <p className="mt-1 text-xs text-red-700">{errors.notes}</p>}
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-900">
            Items <span className="font-normal text-slate-500">({filledCount} of up to {PURCHASE_LIMITS.maxItems})</span>
          </legend>
          {inventory.data.length === 0 && (
            <p className="text-sm text-slate-500">
              There are no stock items yet. <Link to="/inventory" className="underline">Add them in Inventory</Link> first.
            </p>
          )}
          {errors.items && (
            <p role="alert" className="text-sm text-red-700">
              {errors.items}
            </p>
          )}
          {values.items.map((row, index) => {
            const rowErrors = errors.rows[row.key] ?? {};
            const unit = inventory.data.find((i) => i.id === row.inventoryItemId)?.unit;
            return (
              <div key={row.key} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-start">
                <div>
                  <label htmlFor={`${row.key}-item`} className="text-xs font-medium text-slate-600">
                    Stock item {index + 1}
                  </label>
                  <select id={`${row.key}-item`} value={row.inventoryItemId} onChange={(e) => setRow(row.key, "inventoryItemId", e.target.value)} aria-invalid={rowErrors.inventoryItemId ? true : undefined} className={inputClass}>
                    <option value="">Choose…</option>
                    {inventory.data.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit}) — {i.quantityOnHand.toLocaleString()} in stock
                      </option>
                    ))}
                  </select>
                  {rowErrors.inventoryItemId && <p className="mt-1 text-xs text-red-700">{rowErrors.inventoryItemId}</p>}
                </div>
                <div>
                  <label htmlFor={`${row.key}-quantity`} className="text-xs font-medium text-slate-600">
                    Quantity{unit ? ` (${unit})` : ""}
                  </label>
                  <input id={`${row.key}-quantity`} inputMode="numeric" value={row.quantity} onChange={(e) => setRow(row.key, "quantity", e.target.value)} aria-invalid={rowErrors.quantity ? true : undefined} className={inputClass} />
                  {rowErrors.quantity && <p className="mt-1 text-xs text-red-700">{rowErrors.quantity}</p>}
                </div>
                <div>
                  <label htmlFor={`${row.key}-cost`} className="text-xs font-medium text-slate-600">
                    Unit cost
                  </label>
                  <input id={`${row.key}-cost`} inputMode="decimal" value={row.unitCost} onChange={(e) => setRow(row.key, "unitCost", e.target.value)} aria-invalid={rowErrors.unitCost ? true : undefined} className={inputClass} />
                  {rowErrors.unitCost && <p className="mt-1 text-xs text-red-700">{rowErrors.unitCost}</p>}
                </div>
                <button type="button" onClick={() => removeRow(row.key)} className="self-end pb-2 text-sm text-slate-600 hover:underline sm:mt-6">
                  Remove
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={addRow} disabled={values.items.length >= PURCHASE_LIMITS.maxItems} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
              Add item
            </button>
            <p className="text-sm text-slate-700">
              Total: <span className="font-semibold">{formatCents(draftTotalCents(values.items))}</span>
            </p>
          </div>
          <p className="text-xs text-slate-500">Empty rows are ignored. If any stock item no longer exists, the whole purchase is refused and nothing is saved.</p>
        </fieldset>

        <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {create.isPending ? "Saving…" : "Save purchase"}
        </button>
      </form>
    </section>
  );
}
