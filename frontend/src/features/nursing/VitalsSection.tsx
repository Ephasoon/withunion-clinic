import { useState, type FormEvent } from "react";
import { validationDetails } from "../../api";
import { EmptyState, ErrorState, LoadingState, MutationError } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useRecordVitals, useVitals } from "./queries";
import type { VitalSigns } from "./types";
import {
  EMPTY_VITALS_FORM,
  formatBloodPressure,
  formatMeasurement,
  validateVitalsForm,
  VITALS_FIELDS,
  VITALS_NOTES_MAX,
  type VitalsFormErrors,
  type VitalsFormValues,
} from "./vitals";

const cell = (value: string | null) => value ?? <span className="text-slate-400">—</span>;

export function VitalsTable({ vitals }: { vitals: VitalSigns[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Recorded</th>
            <th className="px-3 py-2">BP</th>
            <th className="px-3 py-2">Pulse</th>
            <th className="px-3 py-2">Temp</th>
            <th className="px-3 py-2">RR</th>
            <th className="px-3 py-2">SpO₂</th>
            <th className="px-3 py-2">Weight</th>
            <th className="px-3 py-2">Height</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {vitals.map((v) => (
            <tr key={v.id}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDateTime(v.recordedAt)}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {cell(formatBloodPressure(v.bloodPressureSystolic, v.bloodPressureDiastolic))}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.pulseBpm, 0, "bpm"))}</td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.temperatureCelsius, 1, "°C"))}</td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.respiratoryRate, 0, "/min"))}</td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.oxygenSaturationPct, 0, "%"))}</td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.weightKg, 2, "kg"))}</td>
              <td className="whitespace-nowrap px-3 py-2">{cell(formatMeasurement(v.heightCm, 1, "cm"))}</td>
              <td className="max-w-xs px-3 py-2 whitespace-pre-wrap text-slate-700">{cell(v.notes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VitalsForm({ visitId, patientId }: { visitId: string; patientId: string }) {
  const recordVitals = useRecordVitals(visitId, patientId);
  const [values, setValues] = useState<VitalsFormValues>(EMPTY_VITALS_FORM);
  const [errors, setErrors] = useState<VitalsFormErrors>({});
  const [saved, setSaved] = useState(false);

  const set = (field: keyof VitalsFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
    setSaved(false);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (recordVitals.isPending) return;
    const result = validateVitalsForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    recordVitals.mutate(result.body, {
      onSuccess: () => {
        setValues(EMPTY_VITALS_FORM);
        setErrors({});
        setSaved(true);
      },
      onError: (error) => {
        const details = validationDetails(error) ?? {};
        const fieldErrors: VitalsFormErrors = {};
        for (const [field, messages] of Object.entries(details)) {
          if (field in EMPTY_VITALS_FORM && messages[0]) fieldErrors[field as keyof VitalsFormValues] = messages[0];
        }
        setErrors(fieldErrors);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">Record vitals</h3>
      <p className="text-xs text-slate-500">
        Every field is optional; fill in what was measured. Vitals can be recorded more than once.
      </p>

      {recordVitals.isError && <MutationError error={recordVitals.error} />}
      {errors.form && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.form}
        </p>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Vitals recorded.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {VITALS_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`vitals-${field.key}`} className="text-sm font-medium text-slate-700">
              {field.label} <span className="font-normal text-slate-500">({field.unit})</span>
            </label>
            <input
              id={`vitals-${field.key}`}
              name={field.key}
              type="text"
              inputMode={field.decimals === 0 ? "numeric" : "decimal"}
              autoComplete="off"
              value={values[field.key]}
              onChange={(e) => set(field.key, e.target.value)}
              aria-invalid={errors[field.key] ? true : undefined}
              aria-describedby={`vitals-${field.key}-hint`}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
            />
            <p
              id={`vitals-${field.key}-hint`}
              className={`mt-1 text-xs ${errors[field.key] ? "text-red-700" : "text-slate-500"}`}
            >
              {errors[field.key] ?? `${field.min}–${field.max}`}
            </p>
          </div>
        ))}
      </div>

      <div>
        <label htmlFor="vitals-notes" className="text-sm font-medium text-slate-700">
          Notes
        </label>
        <textarea
          id="vitals-notes"
          rows={2}
          maxLength={VITALS_NOTES_MAX}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          aria-invalid={errors.notes ? true : undefined}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500"
        />
        {errors.notes && <p className="mt-1 text-xs text-red-700">{errors.notes}</p>}
      </div>

      <button
        type="submit"
        disabled={recordVitals.isPending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {recordVitals.isPending ? "Saving…" : "Record vitals"}
      </button>
    </form>
  );
}

/** Every recorded vitals set (oldest first), plus the form while the visit is WITH_NURSE. */
export function VitalsSection({
  visitId,
  patientId,
  canRecord,
}: {
  visitId: string;
  patientId: string;
  canRecord: boolean;
}) {
  // Only mounted after GET /visits/:id succeeded: /vitals returns [] even for a visit that does not exist.
  const vitals = useVitals(visitId, true);

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Vitals</h2>
      {canRecord && <VitalsForm visitId={visitId} patientId={patientId} />}
      {vitals.isPending ? (
        <LoadingState label="Loading vitals…" />
      ) : vitals.isError ? (
        <ErrorState error={vitals.error} onRetry={() => void vitals.refetch()} />
      ) : vitals.data.length === 0 ? (
        <EmptyState>No vitals have been recorded for this visit.</EmptyState>
      ) : (
        <VitalsTable vitals={vitals.data} />
      )}
    </div>
  );
}
