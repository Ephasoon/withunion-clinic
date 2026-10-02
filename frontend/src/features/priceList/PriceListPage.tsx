import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatMoney } from "../billing/money";
import { usePriceList } from "./queries";
import { PriceListStatusBadge } from "./PriceListFields";

/** GET /price-list (owner): every item including inactive, by name. */
export function PriceListPage() {
  const items = usePriceList();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Price List</h1>
        <Link to="/price-list/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Add item
        </Link>
      </div>

      {items.isPending ? (
        <LoadingState label="Loading price list…" />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : items.data.length === 0 ? (
        <EmptyState>No price list items yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 text-right">Price</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.data.map((item) => (
                <tr key={item.id} className={item.isActive ? undefined : "text-slate-500"}>
                  {/* A name can be 255 characters with no spaces; let it wrap so Price and Status stay on screen. */}
                  <td className="px-4 py-2 wrap-anywhere">
                    <Link to={`/price-list/${item.id}`} className="font-medium text-slate-900 hover:underline">
                      {item.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(item.price)}</td>
                  <td className="px-4 py-2">
                    <PriceListStatusBadge isActive={item.isActive} />
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
