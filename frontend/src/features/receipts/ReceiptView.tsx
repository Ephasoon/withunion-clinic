import { LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { billingErrorMessage } from "../billing/billingErrors";
import { formatMoney } from "../billing/money";
import { useReceipt } from "../billing/queries";
import { PAYMENT_METHOD_LABELS } from "../billing/types";
import { openReceiptPrint } from "./api";

/** GET /receipts/invoices/:invoiceId (JSON view) and "Print receipt" (the print page, opened as a new tab). */
export function ReceiptView({ invoiceId }: { invoiceId: string }) {
  const receipt = useReceipt(invoiceId, true);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Receipt</h2>
        <button
          type="button"
          onClick={() => openReceiptPrint(invoiceId)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Print receipt
        </button>
      </div>
      <p className="text-xs text-slate-500">Opens the printable receipt in a new tab; the print dialog opens by itself.</p>

      {receipt.isPending ? (
        <LoadingState label="Loading receipt…" />
      ) : receipt.isError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{billingErrorMessage(receipt.error)}</p>
          <button type="button" onClick={() => void receipt.refetch()} className="mt-1 font-medium underline">
            Try again
          </button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <div>
              <p className="font-medium text-slate-900">{receipt.data.clinic.name}</p>
              <p className="text-slate-600">{receipt.data.clinic.address}</p>
              <p className="text-slate-600">{receipt.data.clinic.phone}</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-medium text-slate-900">{receipt.data.receiptNumber}</p>
              <p className="text-slate-600">{formatDateTime(receipt.data.createdAt)}</p>
              <p className="text-slate-600">Cashier: {receipt.data.cashierName}</p>
            </div>
          </div>
          <p>
            {receipt.data.patientFullName} <span className="font-mono text-xs text-slate-600">{receipt.data.patientCode}</span>
          </p>
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {receipt.data.items.map((item, i) => (
                <tr key={i}>
                  <td className="py-1">{item.description}</td>
                  <td className="py-1 text-right tabular-nums">
                    {item.quantity} × {formatMoney(item.unitPrice)}
                  </td>
                  <td className="py-1 text-right tabular-nums">{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto max-w-xs space-y-0.5 tabular-nums">
            {(
              [
                ["Subtotal", receipt.data.subtotal],
                ["Discount", receipt.data.discount],
                ["Total", receipt.data.total],
                ["Paid", receipt.data.amountPaid],
                ["Balance", receipt.data.balance],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-6">
                <dt className="text-slate-600">{label}</dt>
                <dd className={label === "Total" ? "font-semibold" : undefined}>{formatMoney(value)}</dd>
              </div>
            ))}
          </dl>
          <ul className="text-xs text-slate-600">
            {receipt.data.payments.map((p, i) => (
              <li key={i}>
                {formatMoney(p.amount)} by {PAYMENT_METHOD_LABELS[p.method] ?? p.method}, {formatDateTime(p.paidAt)} (
                {p.recordedByName})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
