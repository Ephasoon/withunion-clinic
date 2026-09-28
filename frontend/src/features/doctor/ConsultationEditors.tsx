import { useState, type FormEvent } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  DIAGNOSIS_MAX,
  EMPTY_PRESCRIPTION_ROW,
  LAB_ORDER_MAX_TESTS,
  MEDICINE_NAME_MAX,
  NOTES_MAX,
  PRESCRIPTION_MAX_ITEMS,
  PRESCRIPTION_TEXT_MAX,
  validateDiagnosis,
  validateLabOrder,
  validateNotes,
  validatePrescription,
  type PrescriptionRow,
  type PrescriptionRowErrors,
} from "./consultationForms";
import { consultationWriteErrorMessage } from "./doctorErrors";
import type { PrescriptionItemBody } from "./types";

// Mutation shapes from useConsultationMutations; only mutate/isPending/isError/error/reset are used.
type Mutation<TVariables> = UseMutationResult<unknown, Error, TVariables, unknown>;

const inputClass =
  "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";
const primaryButton =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

function WriteError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {consultationWriteErrorMessage(error)}
    </p>
  );
}

/** PATCH /consultations/:id { notes }. Reports unsaved edits so completing can warn about them. */
export function NotesEditor({
  initialNotes,
  mutation,
  onDirtyChange,
}: {
  initialNotes: string;
  mutation: Mutation<string>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [saved, setSaved] = useState(initialNotes);
  const [error, setError] = useState<string | null>(null);
  const dirty = notes.trim() !== saved.trim();

  const update = (value: string) => {
    setNotes(value);
    setError(null);
    onDirtyChange(value.trim() !== saved.trim());
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateNotes(notes);
    if (!result.ok) return setError(result.error);
    mutation.mutate(result.value, {
      onSuccess: () => {
        setSaved(result.value);
        setNotes(result.value);
        onDirtyChange(false);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <label htmlFor="consultation-notes" className="sr-only">
        Consultation notes
      </label>
      <textarea
        id="consultation-notes"
        rows={6}
        maxLength={NOTES_MAX}
        value={notes}
        onChange={(e) => update(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={inputClass}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      {mutation.isError && <WriteError error={mutation.error} />}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending || !dirty} className={primaryButton}>
          {mutation.isPending ? "Saving…" : "Save notes"}
        </button>
        <span className="text-xs text-slate-500">{dirty ? "Unsaved changes" : "Saved"}</span>
      </div>
    </form>
  );
}

/** POST /consultations/:id/diagnoses { description }. */
export function DiagnosisForm({ mutation }: { mutation: Mutation<string> }) {
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateDiagnosis(description);
    if (!result.ok) return setError(result.error);
    mutation.mutate(result.value, { onSuccess: () => setDescription("") });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="diagnosis-description" className="sr-only">
          New diagnosis
        </label>
        <input
          id="diagnosis-description"
          maxLength={DIAGNOSIS_MAX}
          value={description}
          placeholder="Add a diagnosis"
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="submit" disabled={mutation.isPending} className={primaryButton}>
          {mutation.isPending ? "Adding…" : "Add diagnosis"}
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {mutation.isError && <WriteError error={mutation.error} />}
    </form>
  );
}

/** POST /consultations/:id/lab-orders { testNames } — one test per line. */
export function LabOrderForm({ mutation }: { mutation: Mutation<string[]> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validateLabOrder(text);
    if (!result.ok) return setError(result.error);
    mutation.mutate(result.value, { onSuccess: () => setText("") });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <label htmlFor="lab-tests" className="text-sm font-medium text-slate-700">
        Order lab tests <span className="font-normal text-slate-500">(one per line, up to {LAB_ORDER_MAX_TESTS})</span>
      </label>
      <textarea
        id="lab-tests"
        rows={3}
        value={text}
        placeholder={"Malaria RDT\nCBC"}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        className={inputClass}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      {mutation.isError && <WriteError error={mutation.error} />}
      <button type="submit" disabled={mutation.isPending} className={primaryButton}>
        {mutation.isPending ? "Recording…" : "Record lab order"}
      </button>
    </form>
  );
}

const ROW_FIELDS: Array<{ key: keyof PrescriptionRow; label: string; max: number; wide?: boolean }> = [
  { key: "medicineName", label: "Medicine *", max: MEDICINE_NAME_MAX, wide: true },
  { key: "strength", label: "Strength", max: PRESCRIPTION_TEXT_MAX },
  { key: "dosage", label: "Dosage", max: PRESCRIPTION_TEXT_MAX },
  { key: "frequency", label: "Frequency", max: PRESCRIPTION_TEXT_MAX },
  { key: "duration", label: "Duration", max: PRESCRIPTION_TEXT_MAX },
  { key: "quantity", label: "Quantity", max: 6 },
];

/** POST /consultations/:id/prescriptions { items } — medicine names are free text. */
export function PrescriptionForm({ mutation }: { mutation: Mutation<PrescriptionItemBody[]> }) {
  const [rows, setRows] = useState<PrescriptionRow[]>([EMPTY_PRESCRIPTION_ROW]);
  const [rowErrors, setRowErrors] = useState<PrescriptionRowErrors[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setField = (index: number, key: keyof PrescriptionRow, value: string) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    setRowErrors((es) => es.map((e, i) => (i === index ? { ...e, [key]: undefined } : e)));
    setError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const result = validatePrescription(rows);
    if (!result.ok) {
      setRowErrors(result.rowErrors);
      setError(result.error ?? null);
      return;
    }
    mutation.mutate(result.items, {
      onSuccess: () => {
        setRows([EMPTY_PRESCRIPTION_ROW]);
        setRowErrors([]);
      },
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-700">
        Prescribe <span className="font-normal text-slate-500">(free-text medicine names, up to {PRESCRIPTION_MAX_ITEMS})</span>
      </p>
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-6">
          {ROW_FIELDS.map((field) => {
            const fieldError = rowErrors[index]?.[field.key];
            return (
              <div key={field.key} className={field.wide ? "sm:col-span-2" : undefined}>
                <label htmlFor={`rx-${index}-${field.key}`} className="text-xs font-medium text-slate-600">
                  {field.label}
                </label>
                <input
                  id={`rx-${index}-${field.key}`}
                  maxLength={field.max}
                  inputMode={field.key === "quantity" ? "numeric" : undefined}
                  value={row[field.key]}
                  onChange={(e) => setField(index, field.key, e.target.value)}
                  aria-invalid={fieldError ? true : undefined}
                  className={`${inputClass} mt-0.5 bg-white`}
                />
                {fieldError && <p className="mt-0.5 text-xs text-red-700">{fieldError}</p>}
              </div>
            );
          })}
          {rows.length > 1 && (
            <div className="sm:col-span-6">
              <button
                type="button"
                onClick={() => {
                  setRows((rs) => rs.filter((_, i) => i !== index));
                  setRowErrors((es) => es.filter((_, i) => i !== index));
                }}
                className="text-xs text-slate-600 hover:underline"
              >
                Remove this medicine
              </button>
            </div>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-700">{error}</p>}
      {mutation.isError && <WriteError error={mutation.error} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={rows.length >= PRESCRIPTION_MAX_ITEMS}
          onClick={() => setRows((rs) => [...rs, EMPTY_PRESCRIPTION_ROW])}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Add another medicine
        </button>
        <button type="submit" disabled={mutation.isPending} className={primaryButton}>
          {mutation.isPending ? "Recording…" : "Record prescription"}
        </button>
      </div>
    </form>
  );
}
