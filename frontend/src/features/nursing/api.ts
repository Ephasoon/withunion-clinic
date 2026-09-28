import { api } from "../../api";
import type { Visit } from "../visits/types";
import type {
  NursingAssessment,
  RecordAssessmentBody,
  RecordVitalsBody,
  VitalSigns,
  VitalSignsResponse,
} from "./types";
import { toVitalSigns } from "./vitals";

const visitPath = (visitId: string) => `/api/v1/visits/${encodeURIComponent(visitId)}`;

/**
 * POST /visits/:id/transition { toStatus: "WITH_NURSE" } → { visit }.
 * WAITING_FOR_NURSE → WITH_NURSE has no module endpoint; the generic one
 * is the only path (docs §3.3). This is the only transition the nursing
 * screens send — the hand-off to the doctor goes through the assessment.
 */
export async function startNursing(visitId: string): Promise<Visit> {
  const { visit } = await api.post<{ visit: Visit }>(`${visitPath(visitId)}/transition`, { toStatus: "WITH_NURSE" });
  return visit;
}

/**
 * GET /visits/:id/vitals → { vitals } (recordedAt ASC), converted to numbers.
 * Returns [] for an unknown visit — it does not check that the visit exists.
 */
export async function fetchVitals(visitId: string, signal?: AbortSignal): Promise<VitalSigns[]> {
  const { vitals } = await api.get<{ vitals: VitalSignsResponse[] }>(`${visitPath(visitId)}/vitals`, { signal });
  return vitals.map(toVitalSigns);
}

/** POST /visits/:id/vitals → 201 { vitals }. Nurse only; the visit must be WITH_NURSE. */
export async function recordVitals(visitId: string, body: RecordVitalsBody): Promise<VitalSigns> {
  const { vitals } = await api.post<{ vitals: VitalSignsResponse }>(`${visitPath(visitId)}/vitals`, body);
  return toVitalSigns(vitals);
}

/** GET /visits/:id/nursing-assessment → { assessment } — null when none recorded yet; 404 for an unknown visit. */
export async function fetchAssessment(visitId: string, signal?: AbortSignal): Promise<NursingAssessment | null> {
  const { assessment } = await api.get<{ assessment: NursingAssessment | null }>(
    `${visitPath(visitId)}/nursing-assessment`,
    { signal }
  );
  return assessment;
}

/**
 * POST /visits/:id/nursing-assessment → 201 { assessment, visitStatus: "WAITING_FOR_DOCTOR" }.
 * Upserts the assessment, then moves the visit WITH_NURSE → WAITING_FOR_DOCTOR
 * (two steps, not one transaction).
 */
export async function recordAssessment(
  visitId: string,
  body: RecordAssessmentBody
): Promise<{ assessment: NursingAssessment; visitStatus: string }> {
  return api.post<{ assessment: NursingAssessment; visitStatus: string }>(
    `${visitPath(visitId)}/nursing-assessment`,
    body
  );
}
