import { api } from "../../api";
import type { Visit } from "../visits/types";
import type { CreatePatientBody, Patient, UpdatePatientBody } from "./types";

/**
 * GET /api/v1/patients?search=&limit=&includeInactive= → { patients }.
 * Active patients only, unless includeInactive (then active ones come
 * first); no search = newest first. Limit 1–100, no offset or total.
 * includeInactive is sent only when true — the backend's default is false.
 */
export async function searchPatients(
  params: { search: string; limit: number; includeInactive?: boolean },
  signal?: AbortSignal
): Promise<Patient[]> {
  const search = params.search.trim();
  const { patients } = await api.get<{ patients: Patient[] }>("/api/v1/patients", {
    query: {
      search: search === "" ? undefined : search,
      limit: params.limit,
      includeInactive: params.includeInactive ? "true" : undefined,
    },
    signal,
  });
  return patients;
}

/** GET /api/v1/patients/:id → { patient } (inactive patients included). */
export async function fetchPatient(patientId: string, signal?: AbortSignal): Promise<Patient> {
  const { patient } = await api.get<{ patient: Patient }>(`/api/v1/patients/${encodeURIComponent(patientId)}`, {
    signal,
  });
  return patient;
}

/** GET /api/v1/patients/:id/visits → { visits } — every status, newest first. */
export async function fetchPatientVisits(patientId: string, signal?: AbortSignal): Promise<Visit[]> {
  const { visits } = await api.get<{ visits: Visit[] }>(`/api/v1/patients/${encodeURIComponent(patientId)}/visits`, {
    signal,
  });
  return visits;
}

/** POST /api/v1/patients → 201 { patient }. Reception only. */
export async function createPatient(body: CreatePatientBody): Promise<Patient> {
  const { patient } = await api.post<{ patient: Patient }>("/api/v1/patients", body);
  return patient;
}

/**
 * PATCH /api/v1/patients/:id with only the changed fields → { patient }.
 * Reception only. Also deactivates/reactivates via status (no delete).
 */
export async function updatePatient(patientId: string, body: UpdatePatientBody): Promise<Patient> {
  const { patient } = await api.patch<{ patient: Patient }>(`/api/v1/patients/${encodeURIComponent(patientId)}`, body);
  return patient;
}
