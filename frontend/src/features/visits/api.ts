import { api } from "../../api";
import type { QueueEvent, ReceptionTransitionTarget, Visit } from "./types";

/** GET /api/v1/visits/today → { visits } — created today only, role-scoped (owner/reception: all statuses). */
export async function fetchTodayVisits(signal?: AbortSignal): Promise<Visit[]> {
  const { visits } = await api.get<{ visits: Visit[] }>("/api/v1/visits/today", { signal });
  return visits;
}

/** GET /api/v1/visits/:id → { visit, history } (history changedAt ASC). */
export async function fetchVisit(visitId: string, signal?: AbortSignal): Promise<{ visit: Visit; history: QueueEvent[] }> {
  return api.get<{ visit: Visit; history: QueueEvent[] }>(`/api/v1/visits/${encodeURIComponent(visitId)}`, { signal });
}

/** POST /api/v1/visits { patientId } → 201 { visit } (status REGISTERED). Reception only. */
export async function createVisit(patientId: string): Promise<Visit> {
  const { visit } = await api.post<{ visit: Visit }>("/api/v1/visits", { patientId });
  return visit;
}

/**
 * POST /api/v1/visits/:id/transition { toStatus, reason? } → { visit }.
 * Only reception's own targets are accepted by the type. `reason` is
 * sent only for CANCELLED, where the backend requires it.
 */
export async function transitionVisit(
  visitId: string,
  input: { toStatus: "WAITING_FOR_NURSE" | "WAITING_FOR_DOCTOR" } | { toStatus: "CANCELLED"; reason: string }
): Promise<Visit> {
  const body: { toStatus: ReceptionTransitionTarget; reason?: string } =
    input.toStatus === "CANCELLED" ? { toStatus: "CANCELLED", reason: input.reason } : { toStatus: input.toStatus };
  const { visit } = await api.post<{ visit: Visit }>(`/api/v1/visits/${encodeURIComponent(visitId)}/transition`, body);
  return visit;
}

/**
 * POST /api/v1/visits/:id/send-to-lab { testNames } → 201 { order }.
 * Reception only, REGISTERED visits only: creates a lab order with no
 * consultation and moves the visit to WAITING_FOR_LAB.
 */
export async function sendVisitToLab(visitId: string, testNames: string[]): Promise<{ id: string }> {
  const { order } = await api.post<{ order: { id: string } }>(`/api/v1/visits/${encodeURIComponent(visitId)}/send-to-lab`, {
    testNames,
  });
  return order;
}
