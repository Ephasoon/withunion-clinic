import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { validationDetails } from "../../api";
import { MutationError } from "../../components/QueryStates";
import { todayIsoDate } from "../../lib/dates";
import {
  AGE_MAX,
  AGE_MIN,
  EMPTY_PATIENT_FORM,
  PATIENT_FIELD_MAX,
  serverFieldErrors,
  validatePatientForm,
  type PatientFormErrors,
  type PatientFormField,
  type PatientFormValues,
} from "./patientForm";
import { useCreatePatient } from "./queries";
import { GENDER_LABELS, GENDERS } from "./types";

const inputClass =
  "mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none aria-[invalid=true]:border-red-500 border-slate-300 focus:border-slate-500";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** POST /patients. Reception only (the route is guarded; the backend enforces it too). */
export function RegisterPatientPage() {
  const navigate = useNavigate();
  const createPatient = useCreatePatient();
  const [values, setValues] = useState<PatientFormValues>(EMPTY_PATIENT_FORM);
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const today = todayIsoDate();

  const set = (field: PatientFormField) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const fieldProps = (field: PatientFormField) => ({
    id: `patient-${field}`,
    name: field,
    value: values[field],
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `patient-${field}-error` : undefined,
    className: inputClass,
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createPatient.isPending) return;
    const result = validatePatientForm(values, today);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    createPatient.mutate(result.body, {
      onSuccess: (patient) => navigate(`/patients/${patient.id}`, { replace: true }),
      onError: (error) => setErrors(serverFieldErrors(validationDetails(error))),
    });
  };

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to="/patients" className="text-sm text-slate-600 hover:underline">
          ← Patients
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Register new patient</h1>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        {createPatient.isError && <MutationError error={createPatient.error} />}

        <Field id="patient-fullName" label="Full name *" error={errors.fullName}>
          <input
            {...fieldProps("fullName")}
            autoFocus
            maxLength={PATIENT_FIELD_MAX.fullName}
            onChange={(e) => set("fullName")(e.target.value)}
          />
        </Field>

        <Field id="patient-gender" label="Gender *" error={errors.gender}>
          <select {...fieldProps("gender")} onChange={(e) => set("gender")(e.target.value)}>
            <option value="">Select…</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {GENDER_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="patient-dateOfBirth"
            label="Date of birth"
            hint="Date of birth or approximate age is required."
            error={errors.dateOfBirth}
          >
            {/* type="date" yields a "YYYY-MM-DD" string, which is sent unchanged. */}
            <input
              {...fieldProps("dateOfBirth")}
              type="date"
              max={today}
              onChange={(e) => set("dateOfBirth")(e.target.value)}
            />
          </Field>
          <Field id="patient-approximateAge" label="Approximate age (years)" error={errors.approximateAge}>
            <input
              {...fieldProps("approximateAge")}
              type="number"
              inputMode="numeric"
              min={AGE_MIN}
              max={AGE_MAX}
              step={1}
              onChange={(e) => {
                set("approximateAge")(e.target.value);
                setErrors((er) => ({ ...er, dateOfBirth: undefined }));
              }}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="patient-phone" label="Phone" error={errors.phone}>
            <input
              {...fieldProps("phone")}
              type="tel"
              maxLength={PATIENT_FIELD_MAX.phone}
              onChange={(e) => set("phone")(e.target.value)}
            />
          </Field>
          <Field id="patient-address" label="Address" error={errors.address}>
            <input
              {...fieldProps("address")}
              maxLength={PATIENT_FIELD_MAX.address}
              onChange={(e) => set("address")(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="patient-emergencyContactName" label="Emergency contact name" error={errors.emergencyContactName}>
            <input
              {...fieldProps("emergencyContactName")}
              maxLength={PATIENT_FIELD_MAX.emergencyContactName}
              onChange={(e) => set("emergencyContactName")(e.target.value)}
            />
          </Field>
          <Field id="patient-emergencyContactPhone" label="Emergency contact phone" error={errors.emergencyContactPhone}>
            <input
              {...fieldProps("emergencyContactPhone")}
              type="tel"
              maxLength={PATIENT_FIELD_MAX.emergencyContactPhone}
              onChange={(e) => set("emergencyContactPhone")(e.target.value)}
            />
          </Field>
        </div>

        <Field id="patient-notes" label="Notes" error={errors.notes}>
          <textarea
            {...fieldProps("notes")}
            rows={3}
            maxLength={PATIENT_FIELD_MAX.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={createPatient.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {createPatient.isPending ? "Registering…" : "Register patient"}
          </button>
          <Link to="/patients" className="text-sm text-slate-600 hover:underline">
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}
