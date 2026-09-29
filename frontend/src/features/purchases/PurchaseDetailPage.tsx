import { useState } from "react";
import { Link, useParams } from "react-router";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime, formatIsoDate } from "../../lib/dates";
import { formatMoney } from "../billing/money";
import { useSuppliers } from "../suppliers/queries";
import { receivePurchaseErrorMessage } from "./purchaseErrors";
import { purchaseTotal } from "./purchaseForm";
import { PurchaseStatusBadge } from "./PurchaseStatusBadge";
import { usePurchase, useReceivePurchase } from "./queries";
import type { PurchaseDetail } from "./types";

/**
 * POST /purchases/:id/receive — all or nothing. A second click is
 * required, after a warning that it adds every line to stock and can't
 * be partial or undone.
 */
function ReceivePanel({ purchase }: { purchase: PurchaseDetail }) {
  const receive = useReceivePurchase(purchase.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onReceive = () => {
    if (receive.isPending) return;
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setError(null);
    receive.mutate(undefined, {
      onSuccess: () => setDone(true),
      onError: (e) => setError(receivePurchaseErrorMessage(e)),
    });
  };

  if (purchase.status === "RECEIVED" && !error) {
    return done ? (
      <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
        Received. All {purchase.items.length} line(s) have been added to stock.
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">Receive</h2>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {purchase.status === "PENDING" && (
        <>
          <p role="note" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Receiving adds the full quantity of every line below to stock, all at once. It can’t be done for part of the
            purchase, and it can’t be undone.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onReceive}
              disabled={receive.isPending}
              className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                confirming ? "bg-red-700 hover:bg-red-800" : "bg-slate-900 hover:bg-slate-700"
              }`}
            >
              {receive.isPending ? "Receiving…" : confirming ? "Yes, add everything to stock" : "Mark as received"}
            </button>
            {confirming && (
              <button type="button" onClick={() => setConfirming(false)} className="text-sm text-slate-600 hover:underline">
                Not yet
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** GET /purchases/:id. Suppliers are loaded only to show whether this one is inactive. */
export function PurchaseDetailPage() {
  const { purchaseId = "" } = useParams();
  const query = usePurchase(purchaseId);
  const suppliers = useSuppliers();

  if (query.isPending) return <LoadingState label="Loading purchase…" />;
  if (query.isError) {
    return <ErrorState error={query.error} notFound="This purchase does not exist." onRetry={() => void query.refetch()} />;
  }
  const purchase = query.data;
  const supplier = suppliers.data?.find((s) => s.id === purchase.supplierId);

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/purchases" className="text-sm text-slate-600 hover:underline">
          ← Purchases
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {purchase.supplierName} · {formatIsoDate(purchase.purchaseDate)}
          </h1>
          <PurchaseStatusBadge status={purchase.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          <Link to={`/suppliers/${purchase.supplierId}`} className="hover:underline">
            Supplier
          </Link>
          {supplier && !supplier.isActive ? " (inactive)" : ""}
          {purchase.referenceNumber ? ` · Ref ${purchase.referenceNumber}` : ""} · recorded {formatDateTime(purchase.createdAt)}
          {purchase.receivedAt ? ` · received ${formatDateTime(purchase.receivedAt)}` : ""}
        </p>
      </div>

      {purchase.notes && <p className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">{purchase.notes}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Stock item</th>
              <th className="px-4 py-2 text-right">Quantity</th>
              <th className="px-4 py-2 text-right">Unit cost</th>
              <th className="px-4 py-2 text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {purchase.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2">{item.inventoryItemName}</td>
                <td className="px-4 py-2 text-right">{item.quantity.toLocaleString()}</td>
                <td className="px-4 py-2 text-right">{formatMoney(item.unitCost)}</td>
                <td className="px-4 py-2 text-right">{formatMoney(purchaseTotal([item]))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-4 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-4 py-2 text-right">{formatMoney(purchaseTotal(purchase.items))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ReceivePanel key={purchase.id} purchase={purchase} />
    </section>
  );
}
