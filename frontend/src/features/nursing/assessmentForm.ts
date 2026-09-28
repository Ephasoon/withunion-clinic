import type { NursingAssessment, RecordAssessmentBody } from "./types";

/** Limits from RecordNursingAssessmentSchema (docs §5.5), after trimming. */
export const CHIEF_COMPLAINT_MAX = 2000;
export const ASSESSMENT_NOTES_MAX = 4000;

export interface AssessmentFormValues {
  chiefComplaint: string;
  assessmentNotes: string;
}

export type AssessmentFormErrors = Partial<Record<keyof AssessmentFormValues | "form", string>>;

/** Form values from the saved assessment (the backend upserts, so a resubmission replaces it). */
export function assessmentFormFrom(assessment: NursingAssessment | null): AssessmentFormValues {
  return {
    chiefComplaint: assessment?.chiefComplaint ?? "",
    assessmentNotes: assessment?.assessmentNotes ?? "",
  };
}

/**
 * Validates the assessment and builds the request body. Blank fields
 * are omitted. At least one field is required: submitting also sends
 * the visit to the doctor, and an empty hand-off note is almost always
 * a mistake.
 */
export function validateAssessmentForm(
  values: AssessmentFormValues
): { ok: true; body: RecordAssessmentBody } | { ok: false; errors: AssessmentFormErrors } {
  const errors: AssessmentFormErrors = {};
  const chiefComplaint = values.chiefComplaint.trim();
  const assessmentNotes = values.assessmentNotes.trim();

  if (chiefComplaint.length > CHIEF_COMPLAINT_MAX) {
    errors.chiefComplaint = `Keep this under ${CHIEF_COMPLAINT_MAX} characters.`;
  }
  if (assessmentNotes.length > ASSESSMENT_NOTES_MAX) {
    errors.assessmentNotes = `Keep this under ${ASSESSMENT_NOTES_MAX} characters.`;
  }
  if (chiefComplaint === "" && assessmentNotes === "") {
    errors.form = "Enter the chief complaint or assessment notes before sending the patient to the doctor.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: RecordAssessmentBody = {};
  if (chiefComplaint !== "") body.chiefComplaint = chiefComplaint;
  if (assessmentNotes !== "") body.assessmentNotes = assessmentNotes;
  return { ok: true, body };
}
