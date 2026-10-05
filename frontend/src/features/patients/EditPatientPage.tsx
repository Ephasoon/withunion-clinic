import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { validationDetails } from "../../api";
import { ErrorState, LoadingState, MutationError } from "../../components/QueryStates";
import { todayIsoDate } from "../../lib/dates";
import { patientPhoneConflict, patientPhoneConflictMessage, type PatientPhoneConflict } from "../../lib/errorMessages";
import { PatientFields, PatientStatusBadge } from "./PatientFields";
import {
  buildPatientPatch,
  patientFormValues,
  serverFieldErrors,
  type PatientFormErrors,
  type PatientFormField,
  type PatientFormValues,
} from "./patientForm";
import { usePatient, useUpdatePatient } from "./queries";
import type { Patient, PatientStatus } from "./types";

export const INACTIVE_WARNING = "Inactive patients disappear from patient search. Their visits and records are kept.";

const PHONE_HINT =
  "Clearing the phone saves it as blank; blank phones are never checked. Any other number must not already belong to another patient.";

/**
 * PATCH /patients/:id — only changed fields, including Active/Inactive
 * (there is no delete). Making a patient inactive needs a second click.
 */
function EditPatientForm({ patient }: { patient: Patient }) {
  const navigate = useNavigate();
  const update = useUpdatePatient(patient.id);
  const [values, setValues] = useState<PatientFormValues>(() => patientFormValues(patient));
  const [status, setStatus] = useState<PatientStatus>(patient.status);
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [phoneConflict, setPhoneConflict] = useState<PatientPhoneConflict | null>(null);
  const [confirmingInactive, setConfirmingInactive] = useState(false);
  const today = todayIsoDate();

  const touch = () => {
    setMessage(null);
    setConfirmingInactive(false);
    update.reset();
  };

  const onChange = (field: PatientFormField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({
      ...e,
      [field]: undefined,
      ...(field === "approximateAge" ? { dateOfBirth: undefined } : {}),
    }));
    if (field === "phone") setPhoneConflict(null);
    touch();
  };

  const onStatus = (next: PatientStatus) => {
    setStatus(next);
    touch();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const patch = buildPatientPatch(patient, { ...values, status }, today);
    if (!patch.ok) {
      setErrors(patch.errors);
      setMessage(patch.message ?? null);
      return;
    }
    // First click on a save that deactivates only shows the warning.
    if (patch.body.status === "inactive" && !confirmingInactive) {
      setConfirmingInactive(true);
      return;
    }
    setConfirmingInactive(false);
    setPhoneConflict(null);
    update.mutate(patch.body, {
      onSuccess: (updated) => navigate(`/patients/${updated.id}`),
      onError: (error) => {
        // The form keeps what was typed; the conflict is shown on the phone field.
        const conflict = patientPhoneConflict(error);
        setPhoneConflict(conflict);
        setErrors(conflict ? { phone: patientPhoneConflictMessage(conflict) } : serverFieldErrors(validationDetails(error)));
      },
    });
  };

  const hints: Partial<Record<PatientFormField, string>> = { phone: PHONE_HINT };
  if (patient.dateOfBirth !== null) hints.dateOfBirth = "A date of birth can be changed but not removed.";
  if (patient.approximateAge !== null) hints.approximateAge = "An approximate age can be changed but not removed.";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
      {message && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {message}
        </p>
      )}
      {update.isError && !phoneConflict && <MutationError error={update.error} />}

      <PatientFields
        idPrefix="edit-patient"
        values={values}
        errors={errors}
        onChange={onChange}
        today={today}
        hints={hints}
        phoneConflict={phoneConflict}
      />

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Status</legend>
        <div className="mt-1 flex gap-4">
          {(["active", "inactive"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => onStatus(s)} />
              {s === "active" ? "Active" : "Inactive"}
            </label>
          ))}
        </div>
      </fieldset>

      {confirmingInactive && (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Make this patient inactive?</p>
          <p className="mt-1">{INACTIVE_WARNING}</p>
          <p className="mt-1">Click “Make inactive and save” again to confirm.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={update.isPending}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
            confirmingInactive ? "bg-amber-700 hover:bg-amber-600" : "bg-slate-900 hover:bg-slate-700"
          }`}
        >
          {update.isPending ? "Saving…" : status === "inactive" && patient.status === "active" ? "Make inactive and save" : "Save changes"}
        </button>
        <Link to={`/patients/${patient.id}`} className="text-sm text-slate-600 hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** /patients/:patientId/edit — reception only, like PATCH /patients/:id. */
export function EditPatientPage() {
  const { patientId = "" } = useParams();
  const query = usePatient(patientId);

  if (query.isPending) return <LoadingState label="Loading patient…" />;
  if (query.isError) {
    return (
      <ErrorState error={query.error} notFound="This patient record does not exist." onRetry={() => void query.refetch()} />
    );
  }
  const patient = query.data;

  return (
    <section className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to={`/patients/${patient.id}`} className="text-sm text-slate-600 hover:underline">
          ← {patient.fullName}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">Edit patient</h1>
          <span className="font-mono text-sm text-slate-600">{patient.patientCode}</span>
          <PatientStatusBadge status={patient.status} />
        </div>
      </div>
      <EditPatientForm key={patient.id} patient={patient} />
    </section>
  );
}
