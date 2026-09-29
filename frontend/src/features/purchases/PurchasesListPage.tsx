import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatIsoDate } from "../../lib/dates";
import { formatMoney } from "../billing/money";
import { purchaseTotal } from "./purchaseForm";
import { PurchaseStatusBadge } from "./PurchaseStatusBadge";
import { usePurchases } from "./queries";

/** GET /purchases (owner): newest first, with items. */
export function PurchasesListPage() {
  const purchases = usePurchases();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Purchases</h1>
        <Link to="/purchases/new" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          New purchase
        </Link>
      </div>

      {purchases.isPending ? (
        <LoadingState label="Loading purchases…" />
      ) : purchases.isError ? (
        <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} />
      ) : purchases.data.length === 0 ? (
        <EmptyState>No purchases yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Purchase date</th>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2 text-right">Lines</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {purchases.data.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link to={`/purchases/${p.id}`} className="font-medium text-slate-900 hover:underline">
                      {formatIsoDate(p.purchaseDate)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{p.supplierName}</td>
                  <td className="px-4 py-2">{p.referenceNumber || "—"}</td>
                  <td className="px-4 py-2 text-right">{p.items.length}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(purchaseTotal(p.items))}</td>
                  <td className="px-4 py-2">
                    <PurchaseStatusBadge status={p.status} />
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
