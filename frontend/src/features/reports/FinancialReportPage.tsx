import { useState } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/dates";
import { formatMoney } from "../billing/money";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "../billing/types";
import { useReport } from "./queries";
import { DateRangePicker, inputClass, ReportFrame, ReportResult, SimpleTable, Stat } from "./ReportControls";
import { financialReportParams } from "./reportParams";
import type { GroupBy } from "./types";
import { useReportRange } from "./useReportRange";

/**
 * GET /reports/financial. Two different things share this response and
 * are shown as two separate sections, because they use different dates:
 * revenue counts payments by the day they were PAID; outstanding lists
 * OPEN invoices CREATED in the range that still have a balance.
 */
export function FinancialReportPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const { range, updateRange, rangeErrors, applied, run } = useReportRange((r) => financialReportParams(r, { groupBy: "day" }));
  const report = useReport("financial", applied);

  return (
    <ReportFrame
      title="Financial"
      description="Revenue (by payment date) and outstanding invoices (by invoice creation date) — two separate views with different dates."
      running={report.isFetching}
      onRun={() => run((r) => financialReportParams(r, { groupBy }))}
      filters={
        <>
          <DateRangePicker value={range} onChange={updateRange} errors={rangeErrors} />
          <div>
            <label htmlFor="report-groupBy" className="text-xs font-medium text-slate-600">
              Revenue by
            </label>
            <select
              id="report-groupBy"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className={inputClass}
            >
              <option value="day">Day</option>
              <option value="month">Month</option>
            </select>
          </div>
        </>
      }
    >
      <ReportResult
        query={report}
        isEmpty={(r) => r.paymentCount === 0 && r.outstandingInvoices.length === 0}
        emptyText="No payments were received and no unpaid invoices were created in this range."
      >
        {(r) => (
          <>
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Revenue received</h3>
                <p className="text-xs text-slate-500">Payments counted by the day they were paid, whenever the invoice was created.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Revenue" value={formatMoney(r.totalRevenue)} />
                <Stat label="Payments" value={r.paymentCount} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <SimpleTable
                  caption="By payment method"
                  columns={[{ label: "Method" }, { label: "Payments", align: "right" }, { label: "Total", align: "right" }]}
                  rows={r.byMethod.map((m) => [
                    PAYMENT_METHOD_LABELS[m.method as PaymentMethod] ?? m.method,
                    m.count,
                    formatMoney(m.total),
                  ])}
                  empty="No payments in this range."
                />
                <SimpleTable
                  caption={r.groupBy === "month" ? "By month paid" : "By day paid"}
                  columns={[{ label: r.groupBy === "month" ? "Month" : "Day" }, { label: "Payments", align: "right" }, { label: "Total", align: "right" }]}
                  rows={r.byPeriod.map((p) => [p.period, p.count, formatMoney(p.total)])}
                  empty="No payments in this range."
                />
              </div>
            </div>

            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Outstanding invoices</h3>
                <p className="text-xs text-slate-500">
                  Open invoices created in this range that still have a balance — filtered by invoice creation date, not
                  payment date. Invoices created before the range are not listed even if still unpaid.
                </p>
              </div>
              <SimpleTable
                caption={`${r.outstandingInvoices.length} outstanding`}
                columns={[
                  { label: "Created" },
                  { label: "Patient" },
                  { label: "Total", align: "right" },
                  { label: "Paid", align: "right" },
                  { label: "Balance", align: "right" },
                ]}
                rows={r.outstandingInvoices.map((i) => [
                  formatDateTime(i.createdAt),
                  <Link key={i.invoiceId} to={`/billing/visits/${i.visitId}`} className="hover:underline">
                    {i.patientFullName} <span className="font-mono text-xs text-slate-500">{i.patientCode}</span>
                  </Link>,
                  formatMoney(i.total),
                  formatMoney(i.amountPaid),
                  formatMoney(i.balance),
                ])}
                empty="No outstanding invoices were created in this range."
              />
            </div>
          </>
        )}
      </ReportResult>
    </ReportFrame>
  );
}
