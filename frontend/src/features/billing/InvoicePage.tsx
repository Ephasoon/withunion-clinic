import { Link, useParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { ReceiptView } from "../receipts/ReceiptView";
import { useVisit } from "../visits/queries";
import { VisitStatusBadge } from "../visits/VisitStatusBadge";
import { allowedBillingActions } from "./billingActions";
import { billingErrorMessage } from "./billingErrors";
import { AddItemsForm, PaymentForm } from "./InvoiceEditors";
import { formatMoney, isZeroBalance } from "./money";
import { useCreateInvoice, useInvoice, useInvoiceMutations, useVisitInvoice } from "./queries";
import { PAYMENT_METHOD_LABELS, type InvoiceDetail } from "./types";

function Totals({ invoice }: { invoice: InvoiceDetail }) {
  const rows = [
    ["Subtotal", invoice.subtotal],
    ["Discount", invoice.discount],
    ["Total", invoice.total],
    ["Paid", invoice.amountPaid],
    ["Balance", invoice.balance],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd
            className={`mt-0.5 text-lg tabular-nums ${
              label === "Balance" && !isZeroBalance(value) ? "font-semibold text-amber-800" : "text-slate-900"
            }`}
          >
            {formatMoney(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A visit's billing: the visit loads first, then its invoice (GET
 * /visits/:id/invoice — null means none yet, so creating one is offered),
 * then the invoice by id (GET /billing/invoices/:id) as the source of truth.
 */
export function InvoicePage() {
  const { visitId = "" } = useParams();
  const auth = useAuth();
  const role = auth.status === "authenticated" ? auth.user.role : "";

  const visitQuery = useVisit(visitId);
  const visitInvoice = useVisitInvoice(visitId, visitQuery.isSuccess);
  const invoiceId = visitInvoice.data?.id ?? null;
  const invoiceQuery = useInvoice(invoiceId);
  const create = useCreateInvoice(visitId);
  const { addItems, pay, complete } = useInvoiceMutations(invoiceId ?? "", visitId);

  if (visitQuery.isPending) return <LoadingState label="Loading visit…" />;
  if (visitQuery.isError) {
    return <ErrorState error={visitQuery.error} notFound="This visit does not exist." onRetry={() => void visitQuery.refetch()} />;
  }
  const { visit } = visitQuery.data;

  const header = (
    <div>
      {/* The billing queue (GET /billing/invoices) is reception-only, so the owner goes back to the visit. */}
      {role === "reception" ? (
        <Link to="/billing" className="text-sm text-slate-600 hover:underline">
          ← Billing
        </Link>
      ) : (
        <Link to={`/visits/${visit.id}`} className="text-sm text-slate-600 hover:underline">
          ← Visit
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Billing — {visit.patientFullName}</h1>
        <span className="font-mono text-sm text-slate-600">{visit.patientCode}</span>
        <VisitStatusBadge status={visit.status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Visit started {formatDateTime(visit.createdAt)}</p>
    </div>
  );

  if (visitInvoice.isPending) return <section className="space-y-6">{header}<LoadingState label="Loading invoice…" /></section>;
  if (visitInvoice.isError) {
    return (
      <section className="space-y-6">
        {header}
        <ErrorState error={visitInvoice.error} onRetry={() => void visitInvoice.refetch()} />
      </section>
    );
  }

  const invoice = invoiceQuery.data ?? visitInvoice.data;
  const actions = allowedBillingActions(role, visit.status, invoice);

  if (invoice === null) {
    return (
      <section className="space-y-6">
        {header}
        {actions.canCreateInvoice ? (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-700">This visit has no invoice yet. Create one, then add the charges.</p>
            {create.isError && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {billingErrorMessage(create.error)}
              </p>
            )}
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate()}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {create.isPending ? "Creating…" : "Create invoice"}
            </button>
          </div>
        ) : (
          <EmptyState>
            {visit.status === "WAITING_FOR_BILLING"
              ? "No invoice has been created for this visit yet."
              : "This visit has no invoice."}
          </EmptyState>
        )}
      </section>
    );
  }

  const readOnlyReason =
    invoice.status === "PAID"
      ? null
      : role !== "reception"
        ? "Only reception can change an invoice. It is shown read-only."
        : visit.status !== "WAITING_FOR_BILLING"
          ? "This visit is no longer waiting for billing, so its invoice can’t be changed or completed."
          : null;

  return (
    <section className="space-y-6">
      {header}

      {complete.isSuccess && (
        <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Billing completed. The invoice is paid and the visit is complete.
        </div>
      )}
      {readOnlyReason && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{readOnlyReason}</p>}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            invoice.status === "PAID" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"
          }`}
        >
          {invoice.status === "PAID" ? "Paid" : "Open"}
        </span>
        <span className="text-slate-600">Invoice created {formatDateTime(invoice.createdAt)}</span>
      </div>

      <Totals invoice={invoice} />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Charges</h2>
          {invoice.items.length === 0 ? (
            <EmptyState>No charges yet.</EmptyState>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Unit price</th>
                  <th className="px-3 py-2 text-right">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{item.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.unitPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Payments</h2>
          {invoice.payments.length === 0 ? (
            <EmptyState>No payments yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
              {invoice.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>
                    {PAYMENT_METHOD_LABELS[p.method] ?? p.method} · {formatDateTime(p.paidAt)}
                  </span>
                  <span className="tabular-nums">{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {actions.canAddItems && <AddItemsForm mutation={addItems} />}
      {actions.canRecordPayment && <PaymentForm mutation={pay} balance={invoice.balance} />}

      {invoice.status === "OPEN" && role === "reception" && visit.status === "WAITING_FOR_BILLING" && (
        <div className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
          <h2 className="text-base font-semibold text-slate-900">Complete billing</h2>
          <p className="text-sm text-slate-700">
            {isZeroBalance(invoice.balance)
              ? invoice.items.length === 0
                ? "There are no charges, so nothing is owed. Completing marks the invoice paid and the visit complete."
                : "The balance is fully paid. Completing marks the invoice paid and the visit complete."
              : `The balance of ${formatMoney(invoice.balance)} must be paid before billing can be completed.`}
          </p>
          {complete.isError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {billingErrorMessage(complete.error)}
            </p>
          )}
          <button
            type="button"
            onClick={() => complete.mutate()}
            disabled={!actions.canComplete || complete.isPending || addItems.isPending || pay.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {complete.isPending ? "Completing…" : "Complete billing"}
          </button>
        </div>
      )}

      {actions.canViewReceipt && <ReceiptView invoiceId={invoice.id} />}
    </section>
  );
}
