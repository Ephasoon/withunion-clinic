import { useEffect, useState, type FormEvent } from "react";
import type { PrescriptionDetail } from "../doctor/types";
import type { InventoryItem } from "../inventory/types";
import {
  canDispenseItem,
  canMarkUnavailable,
  maxDispensable,
  remainingQuantity,
  SKIP_ROW,
  validateDispenseForm,
  type DispenseRow,
  type DispenseRowErrors,
} from "./dispenseForm";
import { dispenseFailureOutcome, pharmacyErrorMessage } from "./pharmacyErrors";
import type { usePrescriptionMutations } from "./queries";

type DispenseMutation = ReturnType<typeof usePrescriptionMutations>["dispense"];

const selectClass =
  "mt-0.5 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

/**
 * POST /dispense for one prescription. Each medicine is skipped,
 * dispensed from a stock item the pharmacist picks, or marked
 * unavailable. All chosen lines go in one batch (one transaction).
 */
export function DispensePanel({
  prescription,
  inventory,
  mutation,
  onDirtyChange,
}: {
  prescription: PrescriptionDetail;
  inventory: InventoryItem[];
  mutation: DispenseMutation;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [rows, setRows] = useState<Record<string, DispenseRow>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, DispenseRowErrors>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const actionable = prescription.items.filter((i) => canDispenseItem(i) || canMarkUnavailable(i));

  useEffect(() => onDirtyChange(Object.values(rows).some((r) => r.action !== "skip")), [rows, onDirtyChange]);

  if (actionable.length === 0) {
    return <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">Every medicine on this prescription is dispensed or unavailable.</p>;
  }

  const update = (itemId: string, patch: Partial<DispenseRow>) => {
    setRows((rs) => ({ ...rs, [itemId]: { ...(rs[itemId] ?? SKIP_ROW), ...patch } }));
    setRowErrors((es) => ({ ...es, [itemId]: {} }));
    setFormError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateDispenseForm(prescription.items, rows, inventory);
    if (!result.ok) {
      setRowErrors(result.rowErrors);
      setFormError(result.error ?? null);
      return;
    }
    mutation.mutate(result.entries, {
      onSuccess: () => {
        setRows({});
        setRowErrors({});
      },
    });
  };

  const stockById = new Map(inventory.map((s) => [s.id, s]));

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
        All the lines you choose are saved together as one batch. If any line fails — for example not enough stock —
        <strong> nothing in the batch is dispensed</strong>.
      </p>

      {actionable.map((item) => {
        const row = rows[item.id] ?? SKIP_ROW;
        const errors = rowErrors[item.id] ?? {};
        const remaining = remainingQuantity(item);
        const stock = stockById.get(row.inventoryItemId);
        const max = row.action === "dispense" && stock ? maxDispensable(item, stock) : null;
        return (
          <fieldset key={item.id} className="rounded-md bg-slate-50 p-3">
            <legend className="text-sm font-medium text-slate-900">
              {item.medicineName}
              <span className="ml-2 text-xs font-normal text-slate-600">
                {remaining === null ? "no quantity prescribed — one dispense completes it" : `${remaining} left to dispense`}
              </span>
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <label htmlFor={`action-${item.id}`} className="text-xs font-medium text-slate-600">
                  Action
                </label>
                <select
                  id={`action-${item.id}`}
                  value={row.action}
                  onChange={(e) => update(item.id, { action: e.target.value as DispenseRow["action"] })}
                  aria-invalid={errors.action ? true : undefined}
                  className={selectClass}
                >
                  <option value="skip">Leave for now</option>
                  {canDispenseItem(item) && <option value="dispense">Dispense</option>}
                  {canMarkUnavailable(item) && <option value="unavailable">Mark unavailable</option>}
                </select>
                {errors.action && <p className="mt-0.5 text-xs text-red-700">{errors.action}</p>}
              </div>
              {row.action === "dispense" && (
                <>
                  <div>
                    <label htmlFor={`stock-${item.id}`} className="text-xs font-medium text-slate-600">
                      From stock item
                    </label>
                    <select
                      id={`stock-${item.id}`}
                      value={row.inventoryItemId}
                      onChange={(e) => update(item.id, { inventoryItemId: e.target.value })}
                      aria-invalid={errors.inventoryItemId ? true : undefined}
                      className={selectClass}
                    >
                      <option value="">Choose stock…</option>
                      {inventory.map((s) => (
                        <option key={s.id} value={s.id} disabled={s.quantityOnHand === 0}>
                          {s.name} — {s.quantityOnHand} {s.unit}
                          {s.quantityOnHand === 0 ? " (out of stock)" : ""}
                        </option>
                      ))}
                    </select>
                    {errors.inventoryItemId && <p className="mt-0.5 text-xs text-red-700">{errors.inventoryItemId}</p>}
                  </div>
                  <div>
                    <label htmlFor={`qty-${item.id}`} className="text-xs font-medium text-slate-600">
                      Quantity{max !== null ? ` (max ${max})` : ""}
                    </label>
                    <input
                      id={`qty-${item.id}`}
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(e) => update(item.id, { quantity: e.target.value })}
                      aria-invalid={errors.quantity ? true : undefined}
                      className={selectClass}
                    />
                    {errors.quantity && <p className="mt-0.5 text-xs text-red-700">{errors.quantity}</p>}
                  </div>
                </>
              )}
            </div>
          </fieldset>
        );
      })}

      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      )}
      {mutation.isError && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {dispenseFailureOutcome(mutation.error) === "rolled-back" ? (
            <>
              <p className="font-medium">Nothing was dispensed.</p>
              <p>{pharmacyErrorMessage(mutation.error, prescription.items)}</p>
            </>
          ) : (
            <>
              <p className="font-medium">It could not be confirmed whether this batch was saved.</p>
              <p>
                {pharmacyErrorMessage(mutation.error, prescription.items)} The quantities shown have been reloaded —
                check them before trying again.
              </p>
            </>
          )}
        </div>
      )}
      <button
        type="submit"
        disabled={mutation.isPending || inventory.length === 0}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {mutation.isPending ? "Saving batch…" : "Save batch"}
      </button>
      {inventory.length === 0 && (
        <p className="text-xs text-slate-500">There are no stock items yet, so nothing can be dispensed.</p>
      )}
    </form>
  );
}
