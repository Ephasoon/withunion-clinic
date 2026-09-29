import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCreateSupplier } from "./queries";
import { supplierErrorMessage } from "./supplierErrors";
import { SupplierFields } from "./SupplierFields";
import { buildCreateSupplier, EMPTY_SUPPLIER, type SupplierErrors, type SupplierValues } from "./supplierForm";

/** POST /suppliers. No uniqueness check: supplier names may repeat. */
export function CreateSupplierPage() {
  const navigate = useNavigate();
  const create = useCreateSupplier();
  const [values, setValues] = useState<SupplierValues>(EMPTY_SUPPLIER);
  const [errors, setErrors] = useState<SupplierErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const onChange = (key: keyof SupplierValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setServerError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = buildCreateSupplier(values);
    if (!result.ok) return setErrors(result.errors);
    create.mutate(result.body, {
      onSuccess: (supplier) => navigate(`/suppliers/${supplier.id}`, { replace: true }),
      onError: (error) => setServerError(supplierErrorMessage(error, "create")),
    });
  };

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <div>
        <Link to="/suppliers" className="text-sm text-slate-600 hover:underline">
          ← Suppliers
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Add supplier</h1>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}
        <SupplierFields idPrefix="supplier" values={values} errors={errors} onChange={onChange} />
        <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {create.isPending ? "Saving…" : "Add supplier"}
        </button>
      </form>
    </section>
  );
}
