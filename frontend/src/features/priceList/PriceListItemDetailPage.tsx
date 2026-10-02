import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { usePriceListItem, useUpdatePriceListItem } from "./queries";
import { priceListErrorMessage } from "./priceListErrors";
import { PriceListFields, PriceListStatusBadge } from "./PriceListFields";
import { buildPriceListPatch, priceListValues, type PriceListErrors, type PriceListValues } from "./priceListForm";
import type { PriceListItem } from "./types";

/** PATCH /price-list/:id — only changed fields; also deactivates/reactivates (there is no delete). */
function EditPriceListItemForm({ item }: { item: PriceListItem }) {
  const update = useUpdatePriceListItem(item.id);
  const [values, setValues] = useState<PriceListValues>(() => priceListValues(item));
  const [isActive, setIsActive] = useState(item.isActive);
  const [errors, setErrors] = useState<PriceListErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const touch = () => {
    setMessage(null);
    setSaved(false);
  };

  const onChange = (key: keyof PriceListValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    touch();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const patch = buildPriceListPatch(item, { ...values, isActive });
    if (!patch.ok) {
      setErrors(patch.errors);
      setMessage(patch.message ?? null);
      return;
    }
    update.mutate(patch.body, {
      onSuccess: (updated) => {
        setValues(priceListValues(updated));
        setIsActive(updated.isActive);
        setSaved(true);
      },
      onError: (e) => setMessage(priceListErrorMessage(e, "update")),
    });
  };

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
      <PriceListFields idPrefix="edit-price-list" values={values} errors={errors} onChange={onChange} />
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => { setIsActive(e.target.checked); touch(); }} />
          Active
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Inactive items stay on record but are not offered when adding charges in Billing.
        </p>
      </div>
      <button type="submit" disabled={update.isPending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {update.isPending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/** GET /price-list/:id. */
export function PriceListItemDetailPage() {
  const { itemId = "" } = useParams();
  const query = usePriceListItem(itemId);

  if (query.isPending) return <LoadingState label="Loading price list item…" />;
  if (query.isError) {
    return <ErrorState error={query.error} notFound="This price list item does not exist." onRetry={() => void query.refetch()} />;
  }
  const item = query.data;

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/price-list" className="text-sm text-slate-600 hover:underline">
          ← Price List
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{item.name}</h1>
          <PriceListStatusBadge isActive={item.isActive} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Added {formatDateTime(item.createdAt)} · updated {formatDateTime(item.updatedAt)}
        </p>
      </div>
      {/* Keyed by id only: after a save the form resets itself from the returned item and keeps the "Saved" note. */}
      <EditPriceListItemForm key={item.id} item={item} />
    </section>
  );
}
