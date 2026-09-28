import { ageFromIsoDate, formatIsoDate } from "../../lib/dates";
import type { Patient } from "./types";

/**
 * Age for display. From dateOfBirth when present (computed from the
 * "YYYY-MM-DD" string, no Date conversion), otherwise the recorded
 * approximate age, marked as approximate.
 */
export function patientAgeText(patient: Pick<Patient, "dateOfBirth" | "approximateAge">, today: string): string {
  if (patient.dateOfBirth) {
    const age = ageFromIsoDate(patient.dateOfBirth, today);
    const born = formatIsoDate(patient.dateOfBirth);
    return age === null ? `Born ${born}` : `${age} yrs (born ${born})`;
  }
  if (patient.approximateAge !== null) return `~${patient.approximateAge} yrs (approx.)`;
  return "Age not recorded";
}
