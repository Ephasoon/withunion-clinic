import { useState, type FormEvent } from "react";
import { validationDetails } from "../../api";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { hasRole } from "../../rbac/access";
import { ROLES } from "../../rbac/roles";
import {
  EMPTY_INVENTORY_FORM,
  inventoryErrorMessage,
  ITEM_NAME_MAX,
  ITEM_UNIT_MAX,
  validateInventoryForm,
  type InventoryFormErrors,
  type InventoryFormValues,
} from "./inventoryForm";
import { useCreateInventoryItem, useInventory } from "./queries";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

/** POST /inventory/items — owner only. */
function NewItemForm() {
  const create = useCreateInventoryItem();
  const [values, setValues] = useState<InventoryFormValues>(EMPTY_INVENTORY_FORM);
  const [errors, setErrors] = useState<InventoryFormErrors>({});
  const [created, setCreated] = useState<string | null>(null);

  const set = (field: keyof InventoryFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setCreated(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = validateInventoryForm(values);
    if (!result.ok) return setErrors(result.errors);
    create.mutate(result.body, {
      onSuccess: (item) => {
        setValues(EMPTY_INVENTORY_FORM);
        setCreated(item.name);
      },
      onError: (error) => {
        const details = validationDetails(error);
        setErrors({ name: details?.name?.[0], unit: details?.unit?.[0], quantityOnHand: details?.quantityOnHand?.[0] });
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Add a stock item</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            { key: "name", label: "Name", max: ITEM_NAME_MAX },
            { key: "unit", label: "Unit", max: ITEM_UNIT_MAX },
            { key: "quantityOnHand", label: "Quantity on hand", max: 8 },
          ] as const
        ).map((field) => (
          <div key={field.key}>
            <label htmlFor={`inv-${field.key}`} className="text-sm font-medium text-slate-700">
              {field.label}
            </label>
            <input
              id={`inv-${field.key}`}
              maxLength={field.max}
              inputMode={field.key === "quantityOnHand" ? "numeric" : undefined}
              value={values[field.key]}
              onChange={(e) => set(field.key, e.target.value)}
              aria-invalid={errors[field.key] ? true : undefined}
              className={inputClass}
            />
            {errors[field.key] && <p className="mt-1 text-xs text-red-700">{errors[field.key]}</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Stock levels can’t be edited afterwards: they change only when medicines are dispensed or purchases are received.
      </p>
      {create.isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {inventoryErrorMessage(create.error)}
        </p>
      )}
      {created && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Added “{created}”.
        </p>
      )}
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {create.isPending ? "Adding…" : "Add stock item"}
      </button>
    </form>
  );
}

/** GET /inventory/items (owner, pharmacy) — read-only list; the owner can add items. No edit controls exist. */
export function InventoryPage() {
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const inventory = useInventory();

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Inventory</h1>
        <p className="mt-1 text-xs text-slate-500">All stock items, by name.</p>
      </div>

      {hasRole(user, ROLES.OWNER) && <NewItemForm />}

      {inventory.isPending ? (
        <LoadingState label="Loading stock…" />
      ) : inventory.isError ? (
        <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />
      ) : inventory.data.length === 0 ? (
        <EmptyState>No stock items yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Unit</th>
                <th className="px-4 py-2 text-right">On hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inventory.data.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 text-slate-900">{item.name}</td>
                  <td className="px-4 py-2 text-slate-700">{item.unit}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${item.quantityOnHand === 0 ? "font-medium text-red-700" : "text-slate-900"}`}
                  >
                    {item.quantityOnHand === 0 ? "Out of stock" : item.quantityOnHand.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
