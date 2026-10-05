/**
 * The patient search page's state lives in the URL — `?q=` for the term
 * and `?inactive=1` for "Include inactive patients" — so Back and reload
 * return to the same results. Nothing is kept in browser storage.
 */
export interface PatientSearchUrlState {
  term: string;
  includeInactive: boolean;
}

/** Only `inactive=1` ticks the box; anything else (absent, "0", "true") leaves it unticked. */
export function readPatientSearchParams(params: URLSearchParams): PatientSearchUrlState {
  return { term: params.get("q") ?? "", includeInactive: params.get("inactive") === "1" };
}

/** URL params for a state; defaults are left out, so the plain page is just /patients. */
export function patientSearchParams(state: PatientSearchUrlState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.term !== "") params.q = state.term;
  if (state.includeInactive) params.inactive = "1";
  return params;
}

/** The line under the search box. */
export function patientSearchHelperText(includeInactive: boolean, searching: boolean): string {
  const scope = includeInactive ? "Active and inactive patients are listed." : "Only active patients are listed.";
  return searching ? scope : `${scope} With no search, the newest registrations are shown.`;
}

/** The empty-state text when a search (or the newest list) returns nothing. */
export function patientSearchEmptyText(term: string, includeInactive: boolean): string {
  const trimmed = term.trim();
  if (trimmed === "") return "No patients have been registered yet.";
  return includeInactive ? `No patients match “${trimmed}”.` : `No active patients match “${trimmed}”.`;
}
