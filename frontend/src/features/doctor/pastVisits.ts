import type { Diagnosis, PatientHistoryVisit } from "./types";

/**
 * The visits to show as history: never the visit being worked on, newest
 * first. The backend already excludes it and sorts (GET /patients/:id/history
 * with excludeVisitId), but the section must not depend on that — a stale
 * cache entry or an omitted query parameter would otherwise list the
 * current visit as its own "history". Ties keep the backend's order.
 */
export function pastVisits(visits: readonly PatientHistoryVisit[], currentVisitId: string): PatientHistoryVisit[] {
  return visits
    .filter((visit) => visit.id !== currentVisitId)
    .map((visit, index) => ({ visit, index, time: Date.parse(visit.createdAt) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map(({ visit }) => visit);
}

/** Every diagnosis on the visit, in consultation order, then in the order recorded. */
export function visitDiagnoses(visit: PatientHistoryVisit): Diagnosis[] {
  return visit.consultations.flatMap((c) => c.diagnoses);
}

/** Whether anything clinical was recorded — a cancelled or abandoned visit often has nothing. */
export function hasClinicalRecords(visit: PatientHistoryVisit): boolean {
  return (
    visitDiagnoses(visit).length > 0 ||
    visit.prescriptions.some((p) => p.items.length > 0) ||
    visit.labOrders.some((o) => o.items.length > 0) ||
    visit.vitals.length > 0
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * A one-line count for the visit's collapsed header, e.g.
 * "1 diagnosis · 2 medicines · 1 lab test · vitals recorded". Only what
 * exists is listed; null when nothing was recorded.
 */
export function historySummary(visit: PatientHistoryVisit): string | null {
  const medicines = visit.prescriptions.reduce((n, p) => n + p.items.length, 0);
  const tests = visit.labOrders.reduce((n, o) => n + o.items.length, 0);
  const parts = [
    visitDiagnoses(visit).length > 0 && plural(visitDiagnoses(visit).length, "diagnosis", "diagnoses"),
    medicines > 0 && plural(medicines, "medicine", "medicines"),
    tests > 0 && plural(tests, "lab test", "lab tests"),
    visit.vitals.length > 0 && "vitals recorded",
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" · ") : null;
}
