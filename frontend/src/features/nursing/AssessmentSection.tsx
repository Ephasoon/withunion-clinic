import { useState, type FormEvent } from "react";
import { validationDetails } from "../../api";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import {
  assessmentFormFrom,
  ASSESSMENT_NOTES_MAX,
  CHIEF_COMPLAINT_MAX,
  validateAssessmentForm,
  type AssessmentFormErrors,
  type AssessmentFormValues,
} from "./assessmentForm";
import type { useAssessment, useRecordAssessment } from "./queries";
import type { NursingAssessment } from "./types";

type AssessmentQuery = ReturnType<typeof useAssessment>;
type RecordAssessmentMutation = ReturnType<typeof useRecordAssessment>;

function AssessmentView({ assessment }: { assessment: NursingAssessment }) {
  return (
    <dl className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Chief complaint</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{assessment.chiefComplaint ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Assessment notes</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{assessment.assessmentNotes ?? "—"}</dd>
      </div>
      <p className="text-xs text-slate-500">Recorded {formatDateTime(assessment.createdAt)}</p>
    </dl>
  );
}

function AssessmentForm({
  initial,
  mutation,
}: {
  initial: AssessmentFormValues;
  mutation: RecordAssessmentMutation;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<AssessmentFormErrors>({});

  const set = (field: keyof AssessmentFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateAssessmentForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    mutation.mutate(result.body, {
      onError: (error) => {
        const details = validationDetails(error);
        setErrors({
          chiefComplaint: details?.chiefComplaint?.[0],
          assessmentNotes: details?.assessmentNotes?.[0],
        });
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        Saving the assessment sends the patient to the doctor’s queue. Record vitals first.
      </p>
      {errors.form && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.form}
        </p>
      )}
      <div>
        <label htmlFor="assessment-chiefComplaint" className="text-sm font-medium text-slate-700">
          Chief complaint
        </label>
        <textarea
          id="assessment-chiefComplaint"
          rows={2}
          maxLength={CHIEF_COMPLAINT_MAX}
          value={values.chiefComplaint}
          onChange={(e) => set("chiefComplaint", e.target.value)}
          aria-invalid={errors.chiefComplaint ? true : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
        />
        {errors.chiefComplaint && <p className="mt-1 text-xs text-red-700">{errors.chiefComplaint}</p>}
      </div>
      <div>
        <label htmlFor="assessment-assessmentNotes" className="text-sm font-medium text-slate-700">
          Assessment notes
        </label>
        <textarea
          id="assessment-assessmentNotes"
          rows={4}
          maxLength={ASSESSMENT_NOTES_MAX}
          value={values.assessmentNotes}
          onChange={(e) => set("assessmentNotes", e.target.value)}
          aria-invalid={errors.assessmentNotes ? true : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
        />
        {errors.assessmentNotes && <p className="mt-1 text-xs text-red-700">{errors.assessmentNotes}</p>}
      </div>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {mutation.isPending ? "Sending…" : "Save assessment and send to doctor"}
      </button>
    </form>
  );
}

/**
 * The nursing assessment: the form while the visit is WITH_NURSE
 * (pre-filled with any saved assessment, since the backend upserts),
 * otherwise the saved assessment read-only.
 */
export function AssessmentSection({
  assessment,
  canRecord,
  mutation,
}: {
  assessment: AssessmentQuery;
  canRecord: boolean;
  mutation: RecordAssessmentMutation;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Nursing assessment</h2>
      {assessment.isPending ? (
        <LoadingState label="Loading assessment…" />
      ) : assessment.isError ? (
        <ErrorState error={assessment.error} onRetry={() => void assessment.refetch()} />
      ) : canRecord ? (
        // Re-mount when a saved assessment appears so the form starts from it.
        <AssessmentForm
          key={assessment.data?.id ?? "new"}
          initial={assessmentFormFrom(assessment.data)}
          mutation={mutation}
        />
      ) : assessment.data ? (
        <AssessmentView assessment={assessment.data} />
      ) : (
        <EmptyState>No nursing assessment has been recorded for this visit.</EmptyState>
      )}
    </div>
  );
}
