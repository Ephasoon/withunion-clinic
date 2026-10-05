import { isValidIsoDate } from "../../lib/dates";
import { GENDERS, type CreatePatientBody, type Gender, type Patient, type PatientStatus, type UpdatePatientBody } from "./types";

/**
 * Registration form rules, mirroring CreatePatientSchema
 * (server/src/modules/patients/patients.schema.ts, docs §5.3) so that
 * a form that passes here is accepted by the backend.
 */

export interface PatientFormValues {
  fullName: string;
  gender: Gender | "";
  /** Exactly what <input type="date"> produces: "" or "YYYY-MM-DD". Never converted to a Date. */
  dateOfBirth: string;
  /** Raw text from the age input. */
  approximateAge: string;
  phone: string;
  address: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  notes: string;
}

export type PatientFormField = keyof PatientFormValues;
export type PatientFormErrors = Partial<Record<PatientFormField, string>>;

export const EMPTY_PATIENT_FORM: PatientFormValues = {
  fullName: "",
  gender: "",
  dateOfBirth: "",
  approximateAge: "",
  phone: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  notes: "",
};

/** Max lengths after trimming, from CreatePatientSchema. */
export const PATIENT_FIELD_MAX = {
  fullName: 255,
  phone: 32,
  address: 2000,
  emergencyContactName: 255,
  emergencyContactPhone: 32,
  notes: 2000,
} as const;

export const AGE_MIN = 0;
export const AGE_MAX = 150;

const OPTIONAL_TEXT_FIELDS = ["phone", "address", "emergencyContactName", "emergencyContactPhone", "notes"] as const;

export type PatientFormResult =
  | { ok: true; body: CreatePatientBody }
  | { ok: false; errors: PatientFormErrors };

/**
 * Validates the form and builds the request body.
 * `today` ("YYYY-MM-DD") is passed in so the rule is testable.
 */
export function validatePatientForm(values: PatientFormValues, today: string): PatientFormResult {
  const errors: PatientFormErrors = {};

  const fullName = values.fullName.trim();
  if (fullName === "") errors.fullName = "Enter the patient's full name.";
  else if (fullName.length > PATIENT_FIELD_MAX.fullName) {
    errors.fullName = `Keep the name under ${PATIENT_FIELD_MAX.fullName} characters.`;
  }

  if (!(GENDERS as readonly string[]).includes(values.gender)) errors.gender = "Select a gender.";

  const dateOfBirth = values.dateOfBirth.trim();
  if (dateOfBirth !== "") {
    if (!isValidIsoDate(dateOfBirth)) errors.dateOfBirth = "Enter a valid date of birth.";
    // Both are "YYYY-MM-DD", so string order is date order.
    else if (dateOfBirth > today) errors.dateOfBirth = "Date of birth cannot be in the future.";
  }

  const ageText = values.approximateAge.trim();
  let approximateAge: number | undefined;
  if (ageText !== "") {
    if (!/^\d+$/.test(ageText)) {
      errors.approximateAge = "Enter the age as a whole number of years.";
    } else {
      approximateAge = Number(ageText);
      if (approximateAge < AGE_MIN || approximateAge > AGE_MAX) {
        errors.approximateAge = `Age must be between ${AGE_MIN} and ${AGE_MAX}.`;
      }
    }
  }

  // Same rule and same field as the backend's refine: one of the two is required,
  // and the error is reported on dateOfBirth.
  if (dateOfBirth === "" && ageText === "") {
    errors.dateOfBirth = "Enter a date of birth or an approximate age.";
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (values[field].trim().length > PATIENT_FIELD_MAX[field]) {
      errors[field] = `Keep this under ${PATIENT_FIELD_MAX[field]} characters.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: CreatePatientBody = { fullName, gender: values.gender as Gender };
  if (dateOfBirth !== "") body.dateOfBirth = dateOfBirth;
  if (approximateAge !== undefined) body.approximateAge = approximateAge;
  // Empty optional fields are omitted rather than sent as "".
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = values[field].trim();
    if (value !== "") body[field] = value;
  }
  return { ok: true, body };
}

/**
 * Field errors from a backend VALIDATION_ERROR (`details`, keyed by
 * field) mapped onto this form. Unknown keys are ignored.
 */
export function serverFieldErrors(details: Record<string, string[]> | null): PatientFormErrors {
  if (!details) return {};
  const errors: PatientFormErrors = {};
  for (const field of Object.keys(EMPTY_PATIENT_FORM) as PatientFormField[]) {
    const message = details[field]?.[0];
    if (message) errors[field] = message;
  }
  return errors;
}

/** The form's starting values for an existing patient (null fields become ""). */
export function patientFormValues(patient: Patient): PatientFormValues {
  return {
    fullName: patient.fullName,
    gender: patient.gender,
    dateOfBirth: patient.dateOfBirth ?? "",
    approximateAge: patient.approximateAge === null ? "" : String(patient.approximateAge),
    phone: patient.phone ?? "",
    address: patient.address ?? "",
    emergencyContactName: patient.emergencyContactName ?? "",
    emergencyContactPhone: patient.emergencyContactPhone ?? "",
    notes: patient.notes ?? "",
  };
}

export const NO_CHANGES_MESSAGE = "Change at least one field (details or status) before saving.";

export const DOB_NOT_REMOVABLE = "A date of birth can be changed but not removed.";
export const AGE_NOT_REMOVABLE = "An approximate age can be changed but not removed.";

/**
 * PATCH /patients/:id body with only what changed, compared after
 * trimming (the backend trims). Validation is the registration rules
 * (validatePatientForm), so an edit can't save what registration would
 * refuse. The backend accepts an empty body as a no-op, so "nothing
 * changed" is caught here with a clear message, as Suppliers and Price
 * List do.
 *
 * Fields can't be set to null (docs §7.6). A cleared phone, address,
 * emergency contact or notes is sent as "" (stored as an empty string —
 * an empty phone is never checked for duplicates). A recorded date of
 * birth or approximate age can't be removed — "" is not a valid date
 * and the age must be a number — so clearing one is refused here.
 * dateOfBirth stays the "YYYY-MM-DD" string throughout.
 */
export function buildPatientPatch(
  original: Patient,
  draft: PatientFormValues & { status: PatientStatus },
  today: string
): { ok: true; body: UpdatePatientBody } | { ok: false; errors: PatientFormErrors; message?: string } {
  const validated = validatePatientForm(draft, today);
  const errors: PatientFormErrors = validated.ok ? {} : { ...validated.errors };
  const dateOfBirth = draft.dateOfBirth.trim();
  const ageText = draft.approximateAge.trim();
  if (!errors.dateOfBirth && original.dateOfBirth !== null && dateOfBirth === "") errors.dateOfBirth = DOB_NOT_REMOVABLE;
  if (!errors.approximateAge && original.approximateAge !== null && ageText === "") {
    errors.approximateAge = AGE_NOT_REMOVABLE;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const current = patientFormValues(original);
  const body: UpdatePatientBody = {};
  const fullName = draft.fullName.trim();
  if (fullName !== current.fullName) body.fullName = fullName;
  if (draft.gender !== original.gender) body.gender = draft.gender as Gender;
  if (dateOfBirth !== current.dateOfBirth) body.dateOfBirth = dateOfBirth;
  if (ageText !== "" && Number(ageText) !== original.approximateAge) body.approximateAge = Number(ageText);
  for (const field of OPTIONAL_TEXT_FIELDS) {
    const value = draft[field].trim();
    if (value !== current[field]) body[field] = value;
  }
  if (draft.status !== original.status) body.status = draft.status;
  if (Object.keys(body).length === 0) return { ok: false, errors: {}, message: NO_CHANGES_MESSAGE };
  return { ok: true, body };
}
