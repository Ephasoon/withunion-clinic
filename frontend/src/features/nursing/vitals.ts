import type { RecordVitalsBody, VitalSigns, VitalSignsResponse } from "./types";

/**
 * Vitals fields with the backend's accepted ranges (RecordVitalsSchema,
 * docs §5.5) and stored precision. The ranges are the backend's sanity
 * bounds for catching typos, not clinical limits.
 */
export const VITALS_FIELDS = [
  { key: "bloodPressureSystolic", label: "BP systolic", unit: "mmHg", min: 30, max: 300, decimals: 0 },
  { key: "bloodPressureDiastolic", label: "BP diastolic", unit: "mmHg", min: 20, max: 200, decimals: 0 },
  { key: "pulseBpm", label: "Pulse", unit: "bpm", min: 20, max: 300, decimals: 0 },
  { key: "temperatureCelsius", label: "Temperature", unit: "°C", min: 25, max: 45, decimals: 1 },
  { key: "respiratoryRate", label: "Respiratory rate", unit: "/min", min: 4, max: 80, decimals: 0 },
  { key: "oxygenSaturationPct", label: "SpO₂", unit: "%", min: 30, max: 100, decimals: 0 },
  { key: "weightKg", label: "Weight", unit: "kg", min: 0.5, max: 400, decimals: 2 },
  { key: "heightCm", label: "Height", unit: "cm", min: 20, max: 250, decimals: 1 },
] as const;

export type VitalsNumericField = (typeof VITALS_FIELDS)[number]["key"];
export type VitalsFormValues = Record<VitalsNumericField, string> & { notes: string };
export type VitalsFormErrors = Partial<Record<VitalsNumericField | "notes" | "form", string>>;

export const VITALS_NOTES_MAX = 2000;

export const EMPTY_VITALS_FORM: VitalsFormValues = {
  bloodPressureSystolic: "",
  bloodPressureDiastolic: "",
  pulseBpm: "",
  temperatureCelsius: "",
  respiratoryRate: "",
  oxygenSaturationPct: "",
  weightKg: "",
  heightCm: "",
  notes: "",
};

const NUMBER_TEXT = /^\d+(\.\d+)?$/;

export type VitalsFormResult = { ok: true; body: RecordVitalsBody } | { ok: false; errors: VitalsFormErrors };

/**
 * Validates the vitals form and builds the request body. Blank fields
 * are omitted. Whole-number fields reject decimals; decimal fields
 * reject more places than the database stores (so nothing is silently
 * rounded). At least one measurement or a note is required, so an
 * empty row is never recorded.
 */
export function validateVitalsForm(values: VitalsFormValues): VitalsFormResult {
  const errors: VitalsFormErrors = {};
  const body: RecordVitalsBody = {};

  for (const field of VITALS_FIELDS) {
    const text = values[field.key].trim();
    if (text === "") continue;
    if (!NUMBER_TEXT.test(text)) {
      errors[field.key] = field.decimals === 0 ? "Enter a whole number." : "Enter a number, e.g. 37.5.";
      continue;
    }
    const places = text.includes(".") ? text.split(".")[1]!.length : 0;
    if (places > field.decimals) {
      errors[field.key] =
        field.decimals === 0
          ? "Enter a whole number."
          : `Use at most ${field.decimals} decimal place${field.decimals === 1 ? "" : "s"}.`;
      continue;
    }
    const value = Number(text);
    if (value < field.min || value > field.max) {
      errors[field.key] = `Must be between ${field.min} and ${field.max} ${field.unit}.`;
      continue;
    }
    body[field.key] = value;
  }

  const notes = values.notes.trim();
  if (notes.length > VITALS_NOTES_MAX) errors.notes = `Keep notes under ${VITALS_NOTES_MAX} characters.`;
  else if (notes !== "") body.notes = notes;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (Object.keys(body).length === 0) return { ok: false, errors: { form: "Enter at least one measurement or a note." } };
  return { ok: true, body };
}

/**
 * Converts a NUMERIC column value from the API ("37.5", "70.25") to a
 * number. null, blank or unparseable input gives null — never NaN.
 */
export function parseNumericString(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An API vitals row with temperature, weight and height converted to numbers. */
export function toVitalSigns(row: VitalSignsResponse): VitalSigns {
  return {
    ...row,
    temperatureCelsius: parseNumericString(row.temperatureCelsius),
    weightKg: parseNumericString(row.weightKg),
    heightCm: parseNumericString(row.heightCm),
  };
}

/** "120/80" from the two blood-pressure values; a missing side shows as "–". */
export function formatBloodPressure(systolic: number | null, diastolic: number | null): string | null {
  if (systolic === null && diastolic === null) return null;
  return `${systolic ?? "–"}/${diastolic ?? "–"}`;
}

/** A number with a fixed count of decimals and its unit, or null when missing. */
export function formatMeasurement(value: number | null, decimals: number, unit: string): string | null {
  if (value === null) return null;
  return `${value.toFixed(decimals)} ${unit}`;
}
