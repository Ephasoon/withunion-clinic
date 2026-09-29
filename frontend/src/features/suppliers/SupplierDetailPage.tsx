import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useSupplier, useUpdateSupplier } from "./queries";
import { supplierErrorMessage } from "./supplierErrors";
import { SupplierFields, SupplierStatusBadge } from "./SupplierFields";
import { buildSupplierPatch, supplierValues, type SupplierErrors, type SupplierValues } from "./supplierForm";
import type { Supplier } from "./types";

/** PATCH /suppliers/:id — only changed fields; also deactivates/reactivates (there is no delete). */
function EditSupplierForm({ supplier }: { supplier: Supplier }) {
  const update = useUpdateSupplier(supplier.id);
  const [values, setValues] = useState<SupplierValues>(() => supplierValues(supplier));
  const [isActive, setIsActive] = useState(supplier.isActive);
  const [errors, setErrors] = useState<SupplierErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const touch = () => {
    setMessage(null);
    setSaved(false);
  };

  const onChange = (key: keyof SupplierValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    touch();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const patch = buildSupplierPatch(supplier, { ...values, isActive });
    if (!patch.ok) {
      setErrors(patch.errors);
      setMessage(patch.message ?? null);
      return;
    }
    update.mutate(patch.body, {
      onSuccess: (updated) => {
        setValues(supplierValues(updated));
        setIsActive(updated.isActive);
        setSaved(true);
      },
      onError: (e) => setMessage(supplierErrorMessage(e, "update")),
    });
  };

  const hasEmail = (supplier.email ?? "") !== "";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Details</h2>
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {message}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Saved.
        </p>
      )}
      <SupplierFields
        idPrefix="edit-supplier"
        values={values}
        errors={errors}
        onChange={onChange}
        emailHint={hasEmail ? "An email can be changed but not removed." : undefined}
      />
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => { setIsActive(e.target.checked); touch(); }} />
          Active
        </label>
        <p className="mt-1 text-xs text-slate-500">Inactive suppliers stay on record and can still be chosen for purchases.</p>
      </div>
      <button type="submit" disabled={update.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {update.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/** GET /suppliers/:id. */
export function SupplierDetailPage() {
  const { supplierId = "" } = useParams();
  const query = useSupplier(supplierId);

  if (query.isPending) return <LoadingState label="Loading supplier…" />;
  if (query.isError) {
    return <ErrorState error={query.error} notFound="This supplier does not exist." onRetry={() => void query.refetch()} />;
  }
  const supplier = query.data;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/suppliers" className="text-sm text-slate-600 hover:underline">
          ← Suppliers
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{supplier.name}</h1>
          <SupplierStatusBadge isActive={supplier.isActive} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Added {formatDateTime(supplier.createdAt)} · updated {formatDateTime(supplier.updatedAt)}
        </p>
      </div>
      {/* Keyed by id only: after a save the form resets itself from the returned supplier and keeps the "Saved" note. */}
      <EditSupplierForm key={supplier.id} supplier={supplier} />
    </section>
  );
}
