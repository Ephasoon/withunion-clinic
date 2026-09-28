import type { PrescriptionItemBody } from "./types";

/** Limits from consultation.schema.ts (docs §5.6), all measured after trimming. */
export const NOTES_MAX = 8000;
export const DIAGNOSIS_MAX = 2000;
export const TEST_NAME_MAX = 255;
export const LAB_ORDER_MAX_TESTS = 50;
export const MEDICINE_NAME_MAX = 255;
export const PRESCRIPTION_TEXT_MAX = 100;
export const PRESCRIPTION_MAX_ITEMS = 50;
export const QUANTITY_MAX = 100_000;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** PATCH /consultations/:id { notes } — replaces the notes; an empty string is allowed. */
export function validateNotes(raw: string): Result<string> {
  const notes = raw.trim();
  if (notes.length > NOTES_MAX) return { ok: false, error: `Keep notes under ${NOTES_MAX} characters.` };
  return { ok: true, value: notes };
}

/** POST /consultations/:id/diagnoses { description } — trimmed, 1–2000. */
export function validateDiagnosis(raw: string): Result<string> {
  const description = raw.trim();
  if (description === "") return { ok: false, error: "Enter the diagnosis." };
  if (description.length > DIAGNOSIS_MAX) return { ok: false, error: `Keep the diagnosis under ${DIAGNOSIS_MAX} characters.` };
  return { ok: true, value: description };
}

/**
 * POST /consultations/:id/lab-orders { testNames } — one test per line
 * in the form; blank lines are ignored. 1–50 tests, each 1–255 chars.
 */
export function validateLabOrder(raw: string): Result<string[]> {
  const testNames = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (testNames.length === 0) return { ok: false, error: "Enter at least one test, one per line." };
  if (testNames.length > LAB_ORDER_MAX_TESTS) {
    return { ok: false, error: `One order can hold at most ${LAB_ORDER_MAX_TESTS} tests.` };
  }
  const tooLong = testNames.find((t) => t.length > TEST_NAME_MAX);
  if (tooLong) return { ok: false, error: `Keep each test name under ${TEST_NAME_MAX} characters.` };
  return { ok: true, value: testNames };
}

export interface PrescriptionRow {
  medicineName: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration: string;
  /** Raw text; blank means "not specified". */
  quantity: string;
}

export const EMPTY_PRESCRIPTION_ROW: PrescriptionRow = {
  medicineName: "",
  strength: "",
  dosage: "",
  frequency: "",
  duration: "",
  quantity: "",
};

export type PrescriptionRowErrors = Partial<Record<keyof PrescriptionRow, string>>;

const OPTIONAL_TEXT = ["strength", "dosage", "frequency", "duration"] as const;

function isBlankRow(row: PrescriptionRow): boolean {
  return Object.values(row).every((v) => v.trim() === "");
}

/**
 * POST /consultations/:id/prescriptions { items } — rows left entirely
 * blank are ignored; 1–50 items. medicineName is free text (1–255),
 * the other texts ≤100, quantity a whole number 1–100000 or blank.
 */
export function validatePrescription(
  rows: readonly PrescriptionRow[]
): { ok: true; items: PrescriptionItemBody[] } | { ok: false; rowErrors: PrescriptionRowErrors[]; error?: string } {
  const rowErrors: PrescriptionRowErrors[] = rows.map(() => ({}));
  const items: PrescriptionItemBody[] = [];

  rows.forEach((row, index) => {
    if (isBlankRow(row)) return;
    const errors = rowErrors[index]!;

    const medicineName = row.medicineName.trim();
    if (medicineName === "") errors.medicineName = "Enter the medicine.";
    else if (medicineName.length > MEDICINE_NAME_MAX) errors.medicineName = `Keep under ${MEDICINE_NAME_MAX} characters.`;

    const item: PrescriptionItemBody = { medicineName };
    for (const field of OPTIONAL_TEXT) {
      const value = row[field].trim();
      if (value.length > PRESCRIPTION_TEXT_MAX) errors[field] = `Keep under ${PRESCRIPTION_TEXT_MAX} characters.`;
      else if (value !== "") item[field] = value;
    }

    const quantity = row.quantity.trim();
    if (quantity !== "") {
      if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > QUANTITY_MAX) {
        errors.quantity = `Whole number, 1–${QUANTITY_MAX}.`;
      } else {
        item.quantityPrescribed = Number(quantity);
      }
    }
    items.push(item);
  });

  const hasRowErrors = rowErrors.some((e) => Object.keys(e).length > 0);
  if (hasRowErrors) return { ok: false, rowErrors };
  if (items.length === 0) return { ok: false, rowErrors, error: "Add at least one medicine." };
  if (items.length > PRESCRIPTION_MAX_ITEMS) {
    return { ok: false, rowErrors, error: `One prescription can hold at most ${PRESCRIPTION_MAX_ITEMS} medicines.` };
  }
  return { ok: true, items };
}
