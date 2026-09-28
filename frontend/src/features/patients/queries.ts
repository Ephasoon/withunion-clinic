import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPatient, fetchPatient, fetchPatientVisits, searchPatients } from "./api";
import type { CreatePatientBody } from "./types";

export const patientKeys = {
  all: ["patients"] as const,
  searches: ["patients", "search"] as const,
  search: (search: string, limit: number) => ["patients", "search", { search, limit }] as const,
  detail: (patientId: string) => ["patients", "detail", patientId] as const,
  visits: (patientId: string) => ["patients", "visits", patientId] as const,
};

export function usePatientSearch(search: string, limit: number) {
  const term = search.trim();
  return useQuery({
    queryKey: patientKeys.search(term, limit),
    queryFn: ({ signal }) => searchPatients({ search: term, limit }, signal),
    // Keep showing the previous results while the next search loads.
    placeholderData: keepPreviousData,
  });
}

export function usePatient(patientId: string) {
  return useQuery({
    queryKey: patientKeys.detail(patientId),
    queryFn: ({ signal }) => fetchPatient(patientId, signal),
  });
}

export function usePatientVisits(patientId: string) {
  return useQuery({
    queryKey: patientKeys.visits(patientId),
    queryFn: ({ signal }) => fetchPatientVisits(patientId, signal),
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePatientBody) => createPatient(body),
    onSuccess: (patient) => {
      queryClient.setQueryData(patientKeys.detail(patient.id), patient);
      void queryClient.invalidateQueries({ queryKey: patientKeys.searches });
    },
  });
}
