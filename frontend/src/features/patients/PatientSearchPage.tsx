import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useAuth } from "../../auth/useAuth";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { todayIsoDate } from "../../lib/dates";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { hasRole } from "../../rbac/access";
import { ROLES } from "../../rbac/roles";
import { patientAgeText } from "./patientDisplay";
import { usePatientSearch } from "./queries";
import { GENDER_LABELS } from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** GET /patients?search=&limit= — active patients only, no pagination. */
export function PatientSearchPage() {
  const auth = useAuth();
  const user = auth.status === "authenticated" ? auth.user : null;
  const canRegister = hasRole(user, ROLES.RECEPTION);

  // The search term lives in the URL so Back returns to the same results.
  const [searchParams, setSearchParams] = useSearchParams();
  const term = searchParams.get("q") ?? "";
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const debouncedTerm = useDebouncedValue(term, 300);
  const search = usePatientSearch(debouncedTerm, limit);
  const today = todayIsoDate();

  const onTermChange = (value: string) => {
    setLimit(DEFAULT_LIMIT);
    setSearchParams(value === "" ? {} : { q: value }, { replace: true });
  };

  const patients = search.data ?? [];
  const searching = debouncedTerm.trim() !== "";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Patients</h1>
        {canRegister && (
          <Link
            to="/patients/new"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Register new patient
          </Link>
        )}
      </div>

      <div>
        <label htmlFor="patient-search" className="text-sm font-medium text-slate-700">
          Search by name or phone number
        </label>
        <input
          id="patient-search"
          type="search"
          autoFocus
          maxLength={255}
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
          placeholder="e.g. Amina or 0911"
          className="mt-1 block w-full max-w-lg rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Only active patients are listed. {searching ? "" : "With no search, the newest registrations are shown."}
        </p>
      </div>

      {search.isPending ? (
        <LoadingState label="Searching patients…" />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : patients.length === 0 ? (
        <EmptyState>
          {searching ? `No active patients match “${debouncedTerm.trim()}”.` : "No patients have been registered yet."}
          {canRegister && (
            <>
              {" "}
              <Link to="/patients/new" className="font-medium text-slate-900 underline">
                Register a new patient
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <div className={search.isFetching ? "opacity-60 transition-opacity" : undefined}>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Gender</th>
                  <th className="px-4 py-2">Age</th>
                  <th className="px-4 py-2">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{patient.patientCode}</td>
                    <td className="px-4 py-2">
                      <Link to={`/patients/${patient.id}`} className="font-medium text-slate-900 hover:underline">
                        {patient.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">{GENDER_LABELS[patient.gender]}</td>
                    <td className="px-4 py-2 text-slate-700">{patientAgeText(patient, today)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-700">{patient.phone ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {patients.length === limit && (
            <p className="mt-2 text-xs text-slate-500">
              Showing the first {limit} matches.{" "}
              {limit < MAX_LIMIT ? (
                <button type="button" onClick={() => setLimit(MAX_LIMIT)} className="font-medium text-slate-900 underline">
                  Show up to {MAX_LIMIT}
                </button>
              ) : (
                "Refine the search to narrow the list."
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
