import type { ReactNode } from "react";
import { LabOrdersList, PrescriptionsList, QueryList } from "../doctor/ClinicalRecords";
import { useVisitConsultations, useVisitLabOrders, useVisitPrescriptions } from "../doctor/queries";

function RecordPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

/**
 * This visit's clinical record for reception to bill from: every diagnosis
 * across the visit's consultations, its prescriptions with dispensing status,
 * and its lab orders with results. The same per-visit reads (and cards) as the
 * doctor's consultation page — GET /visits/:id/consultations, /prescriptions
 * and /lab-orders, all open to any authenticated role. Mount only after the
 * visit has loaded.
 */
export function VisitRecord({ visitId }: { visitId: string }) {
  const consultations = useVisitConsultations(visitId, true);
  const prescriptions = useVisitPrescriptions(visitId, true);
  const labOrders = useVisitLabOrders(visitId, true);
  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-slate-900">This visit’s record</h2>
      <RecordPart title="Diagnoses">
        <QueryList
          query={consultations}
          select={(list) => list.filter((c) => c.diagnoses.length > 0)}
          loadingLabel="Loading diagnoses…"
          empty="No diagnoses recorded on this visit."
        >
          {(withDiagnoses) => (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {withDiagnoses.flatMap((c) => c.diagnoses).map((d) => (
                <li key={d.id} className="whitespace-pre-wrap px-4 py-2 text-sm text-slate-900">
                  {d.description}
                </li>
              ))}
            </ul>
          )}
        </QueryList>
      </RecordPart>
      <div className="grid gap-4 lg:grid-cols-2">
        <RecordPart title="Prescriptions">
          <PrescriptionsList query={prescriptions} empty="No prescriptions on this visit." />
        </RecordPart>
        <RecordPart title="Lab orders">
          <LabOrdersList query={labOrders} empty="No lab orders on this visit." />
        </RecordPart>
      </div>
    </div>
  );
}
