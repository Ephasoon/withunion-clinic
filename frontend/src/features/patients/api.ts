import { api } from "../../api";
import type { Visit } from "../visits/types";
import type { CreatePatientBody, Patient } from "./types";

/**
 * GET /api/v1/patients?search=&limit= → { patients }. Active patients
 * only; no search = newest first. Limit 1–100, no offset or total.
 */
export async function searchPatients(
  params: { search: string; limit: number },
  signal?: AbortSignal
): Promise<Patient[]> {
  const search = params.search.trim();
  const { patients } = await api.get<{ patients: Patient[] }>("/api/v1/patients", {
    query: { search: search === "" ? undefined : search, limit: params.limit },
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
