import type { CompletionStatus, LabOrderDetail, PrescriptionDetail } from "./types";

export interface CompletionPreview {
  destination: CompletionStatus;
  /** One-line headline, e.g. "The patient will go to the lab." */
  headline: string;
  /** Why, naming what is outstanding. */
  reason: string;
}

/**
 * Where POST /consultations/:id/complete will send the visit, computed
 * the same way the backend does (docs §3.3), across the whole visit —
 * not just this consultation:
 *   1. any REQUESTED lab order on the visit        → WAITING_FOR_LAB
 *   2. else any PENDING prescription item on it    → WAITING_FOR_PHARMACY
 *   3. else                                        → WAITING_FOR_BILLING
 */
export function previewCompletion(
  labOrders: readonly Pick<LabOrderDetail, "status" | "items">[],
  prescriptions: readonly Pick<PrescriptionDetail, "items">[]
): CompletionPreview {
  const requested = labOrders.filter((o) => o.status === "REQUESTED");
  if (requested.length > 0) {
    const tests = requested.flatMap((o) => o.items.map((i) => i.testName));
    return {
      destination: "WAITING_FOR_LAB",
      headline: "The patient will go to the lab.",
      reason: `${requested.length === 1 ? "1 lab order is" : `${requested.length} lab orders are`} waiting for results${
        tests.length > 0 ? `: ${tests.join(", ")}` : ""
      }. Pharmacy and billing come after the lab and your review.`,
    };
  }

  const pending = prescriptions.flatMap((p) => p.items.filter((i) => i.status === "PENDING"));
  if (pending.length > 0) {
    return {
      destination: "WAITING_FOR_PHARMACY",
      headline: "The patient will go to the pharmacy.",
      reason: `No lab tests are outstanding, and ${
        pending.length === 1 ? "1 medicine is" : `${pending.length} medicines are`
      } waiting to be dispensed: ${pending.map((i) => i.medicineName).join(", ")}.`,
    };
  }

  return {
    destination: "WAITING_FOR_BILLING",
    headline: "The patient will go to billing.",
    reason: "Nothing is outstanding for the lab or the pharmacy on this visit.",
  };
}

/** What happened after completing, from the visitStatus the backend returned. */
export function describeCompletionOutcome(visitStatus: string): string {
  switch (visitStatus) {
    case "WAITING_FOR_LAB":
      return "Consultation completed. The patient has been sent to the lab: this visit has lab orders waiting for results.";
    case "WAITING_FOR_PHARMACY":
      return "Consultation completed. The patient has been sent to the pharmacy: this visit has medicines waiting to be dispensed.";
    case "WAITING_FOR_BILLING":
      return "Consultation completed. The patient has been sent to billing: nothing is outstanding for the lab or the pharmacy.";
    default:
      return `Consultation completed. The visit is now ${visitStatus}.`;
  }
}
