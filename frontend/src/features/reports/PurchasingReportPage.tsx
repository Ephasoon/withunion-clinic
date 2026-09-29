import { useState } from "react";
import { formatMoney } from "../billing/money";
import { useSuppliers } from "../suppliers/queries";
import { useReport } from "./queries";
import { DateRangePicker, inputClass, ReportFrame, ReportResult, SimpleTable, Stat } from "./ReportControls";
import { purchasingReportParams } from "./reportParams";
import { PURCHASE_STATUSES, type PurchaseStatus } from "./types";
import { useReportRange } from "./useReportRange";

const STATUS_LABELS: Record<string, string> = { PENDING: "Pending", RECEIVED: "Received" };

/** GET /reports/purchasing — by purchase date. The supplier filter lists every supplier from GET /suppliers, inactive ones included. */
export function PurchasingReportPage() {
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState<PurchaseStatus | "">("");
  const { range, updateRange, rangeErrors, applied, run } = useReportRange((r) =>
    purchasingReportParams(r, { supplierId: "", status: "" })
  );
  const report = useReport("purchasing", applied);

  const onRun = () => {
    run((r) => purchasingReportParams(r, { supplierId, status }));
  };

  return (
    <ReportFrame
      title="Purchasing"
      description="Purchases by their purchase date."
      running={report.isFetching}
      onRun={onRun}
      filters={
        <>
          <DateRangePicker value={range} onChange={updateRange} errors={rangeErrors} />
          <div>
            <label htmlFor="report-status" className="text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as PurchaseStatus | "")}
              className={inputClass}
            >
              <option value="">All</option>
              {PURCHASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="report-supplierId" className="text-xs font-medium text-slate-600">
              Supplier
            </label>
            <select
              id="report-supplierId"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              disabled={!suppliers.isSuccess}
              className={inputClass}
            >
              <option value="">{suppliers.isPending ? "Loading suppliers…" : "All suppliers"}</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            {suppliers.isError && (
              <p className="mt-0.5 text-xs text-red-700">
                Couldn’t load suppliers.{" "}
                <button type="button" onClick={() => void suppliers.refetch()} className="underline">
                  Try again
                </button>
              </p>
            )}
          </div>
        </>
      }
    >
      <ReportResult query={report} isEmpty={(r) => r.totalPurchases === 0} emptyText="No purchases in this range.">
        {(r) => (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Purchases" value={r.totalPurchases} />
              <Stat label="Units" value={r.totalQuantity.toLocaleString()} />
              <Stat label="Cost" value={formatMoney(r.totalCost)} />
            </div>
            <SimpleTable
              caption="By supplier"
              columns={[
                { label: "Supplier" },
                { label: "Purchases", align: "right" },
                { label: "Units", align: "right" },
                { label: "Cost", align: "right" },
              ]}
              rows={r.bySupplier.map((s) => [s.supplierName, s.purchaseCount, s.totalQuantity, formatMoney(s.totalCost)])}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <SimpleTable
                caption="By status"
                columns={[
                  { label: "Status" },
                  { label: "Purchases", align: "right" },
                  { label: "Units", align: "right" },
                  { label: "Cost", align: "right" },
                ]}
                rows={r.byStatus.map((s) => [STATUS_LABELS[s.status] ?? s.status, s.purchaseCount, s.totalQuantity, formatMoney(s.totalCost)])}
              />
              <SimpleTable
                caption="By purchase date"
                columns={[
                  { label: "Date" },
                  { label: "Purchases", align: "right" },
                  { label: "Units", align: "right" },
                  { label: "Cost", align: "right" },
                ]}
                rows={r.byDate.map((d) => [d.date, d.purchaseCount, d.totalQuantity, formatMoney(d.totalCost)])}
              />
            </div>
          </>
        )}
      </ReportResult>
    </ReportFrame>
  );
}
