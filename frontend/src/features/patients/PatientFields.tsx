import type { ReactNode } from "react";
import { Link } from "react-router";
import type { PatientPhoneConflict } from "../../lib/errorMessages";
import {
  AGE_MAX,
  AGE_MIN,
  PATIENT_FIELD_MAX,
  type PatientFormErrors,
  type PatientFormField,
  type PatientFormValues,
} from "./patientForm";
import { GENDER_LABELS, GENDERS, type PatientStatus } from "./types";

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
  error?: ReactNode;
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

/**
 * The patient form's fields, shared by registration and editing.
 * `phoneConflict` (from a PATIENT_PHONE_ALREADY_EXISTS error) adds an
 * "Open existing patient" link under the phone error; it opens in a new
 * tab so what the user typed here stays put.
 */
export function PatientFields({
  idPrefix,
  values,
  errors,
  onChange,
  today,
  hints = {},
  phoneConflict,
  autoFocus,
}: {
  idPrefix: string;
  values: PatientFormValues;
  errors: PatientFormErrors;
  onChange: (field: PatientFormField, value: string) => void;
  today: string;
  hints?: Partial<Record<PatientFormField, string>>;
  phoneConflict?: PatientPhoneConflict | null;
  autoFocus?: boolean;
}) {
  const id = (field: PatientFormField) => `${idPrefix}-${field}`;
  const fieldProps = (field: PatientFormField) => ({
    id: id(field),
    name: field,
    value: values[field],
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${id(field)}-error` : undefined,
    className: inputClass,
  });

  const phoneError =
    errors.phone && phoneConflict ? (
      <>
        {errors.phone}.{" "}
        <Link
          to={`/patients/${phoneConflict.patientId}`}
          target="_blank"
          rel="noopener"
          className="font-medium underline"
        >
          Open existing patient
        </Link>
      </>
    ) : (
      errors.phone
    );

  return (
    <>
      <Field id={id("fullName")} label="Full name *" hint={hints.fullName} error={errors.fullName}>
        <input
          {...fieldProps("fullName")}
          autoFocus={autoFocus}
          maxLength={PATIENT_FIELD_MAX.fullName}
          onChange={(e) => onChange("fullName", e.target.value)}
        />
      </Field>

      <Field id={id("gender")} label="Gender *" error={errors.gender}>
        <select {...fieldProps("gender")} onChange={(e) => onChange("gender", e.target.value)}>
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
          id={id("dateOfBirth")}
          label="Date of birth"
          hint={hints.dateOfBirth ?? "Date of birth or approximate age is required."}
          error={errors.dateOfBirth}
        >
          {/* type="date" yields a "YYYY-MM-DD" string, which is sent unchanged. */}
          <input
            {...fieldProps("dateOfBirth")}
            type="date"
            max={today}
            onChange={(e) => onChange("dateOfBirth", e.target.value)}
          />
        </Field>
        <Field
          id={id("approximateAge")}
          label="Approximate age (years)"
          hint={hints.approximateAge}
          error={errors.approximateAge}
        >
          <input
            {...fieldProps("approximateAge")}
            type="number"
            inputMode="numeric"
            min={AGE_MIN}
            max={AGE_MAX}
            step={1}
            onChange={(e) => onChange("approximateAge", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("phone")} label="Phone" hint={hints.phone} error={phoneError}>
          <input
            {...fieldProps("phone")}
            type="tel"
            maxLength={PATIENT_FIELD_MAX.phone}
            onChange={(e) => onChange("phone", e.target.value)}
          />
        </Field>
        <Field id={id("address")} label="Address" error={errors.address}>
          <input
            {...fieldProps("address")}
            maxLength={PATIENT_FIELD_MAX.address}
            onChange={(e) => onChange("address", e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id("emergencyContactName")} label="Emergency contact name" error={errors.emergencyContactName}>
          <input
            {...fieldProps("emergencyContactName")}
            maxLength={PATIENT_FIELD_MAX.emergencyContactName}
            onChange={(e) => onChange("emergencyContactName", e.target.value)}
          />
        </Field>
        <Field id={id("emergencyContactPhone")} label="Emergency contact phone" error={errors.emergencyContactPhone}>
          <input
            {...fieldProps("emergencyContactPhone")}
            type="tel"
            maxLength={PATIENT_FIELD_MAX.emergencyContactPhone}
            onChange={(e) => onChange("emergencyContactPhone", e.target.value)}
          />
        </Field>
      </div>

      <Field id={id("notes")} label="Notes" error={errors.notes}>
        <textarea
          {...fieldProps("notes")}
          rows={3}
          maxLength={PATIENT_FIELD_MAX.notes}
          onChange={(e) => onChange("notes", e.target.value)}
        />
      </Field>
    </>
  );
}

export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  if (status === "active") return null;
  return <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">Inactive</span>;
}
