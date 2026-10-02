import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useCreatePriceListItem } from "./queries";
import { priceListErrorMessage } from "./priceListErrors";
import { PriceListFields } from "./PriceListFields";
import { buildCreatePriceListItem, EMPTY_PRICE_LIST_ITEM, type PriceListErrors, type PriceListValues } from "./priceListForm";

/** POST /price-list. A duplicate name (ignoring case and spacing) is refused by the backend. */
export function CreatePriceListItemPage() {
  const navigate = useNavigate();
  const create = useCreatePriceListItem();
  const [values, setValues] = useState<PriceListValues>(EMPTY_PRICE_LIST_ITEM);
  const [errors, setErrors] = useState<PriceListErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const onChange = (key: keyof PriceListValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setServerError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (create.isPending) return;
    const result = buildCreatePriceListItem(values);
    if (!result.ok) return setErrors(result.errors);
    create.mutate(result.body, {
      onSuccess: (item) => navigate(`/price-list/${item.id}`, { replace: true }),
      onError: (error) => setServerError(priceListErrorMessage(error, "create")),
    });
  };

  return (
    <section className="mx-auto max-w-lg space-y-4">
      <div>
        <Link to="/price-list" className="text-sm text-slate-600 hover:underline">
          ← Price List
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Add price list item</h1>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        {serverError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {serverError}
          </p>
        )}
        <PriceListFields idPrefix="price-list" values={values} errors={errors} onChange={onChange} />
        <button type="submit" disabled={create.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {create.isPending ? "Saving…" : "Add item"}
        </button>
      </form>
    </section>
  );
}
