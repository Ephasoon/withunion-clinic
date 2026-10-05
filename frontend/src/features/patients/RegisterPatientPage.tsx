import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { validationDetails } from "../../api";
import { MutationError } from "../../components/QueryStates";
import { todayIsoDate } from "../../lib/dates";
import { patientPhoneConflict, patientPhoneConflictMessage, type PatientPhoneConflict } from "../../lib/errorMessages";
import { PatientFields } from "./PatientFields";
import {
  EMPTY_PATIENT_FORM,
  serverFieldErrors,
  validatePatientForm,
  type PatientFormErrors,
  type PatientFormField,
  type PatientFormValues,
} from "./patientForm";
import { useCreatePatient } from "./queries";

/** POST /patients. Reception only (the route is guarded; the backend enforces it too). */
export function RegisterPatientPage() {
  const navigate = useNavigate();
  const createPatient = useCreatePatient();
  const [values, setValues] = useState<PatientFormValues>(EMPTY_PATIENT_FORM);
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const [phoneConflict, setPhoneConflict] = useState<PatientPhoneConflict | null>(null);
  const today = todayIsoDate();

  const onChange = (field: PatientFormField, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({
      ...e,
      [field]: undefined,
      // Either one satisfies "date of birth or approximate age".
      ...(field === "approximateAge" ? { dateOfBirth: undefined } : {}),
    }));
    if (field === "phone") setPhoneConflict(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createPatient.isPending) return;
    const result = validatePatientForm(values, today);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setPhoneConflict(null);
    createPatient.mutate(result.body, {
      onSuccess: (patient) => navigate(`/patients/${patient.id}`, { replace: true }),
      onError: (error) => {
        // The form keeps what was typed; the conflict is shown on the phone field.
        const conflict = patientPhoneConflict(error);
        setPhoneConflict(conflict);
        setErrors(conflict ? { phone: patientPhoneConflictMessage(conflict) } : serverFieldErrors(validationDetails(error)));
      },
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
        {createPatient.isError && !phoneConflict && <MutationError error={createPatient.error} />}

        <PatientFields
          idPrefix="patient"
          values={values}
          errors={errors}
          onChange={onChange}
          today={today}
          phoneConflict={phoneConflict}
          autoFocus
        />

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
