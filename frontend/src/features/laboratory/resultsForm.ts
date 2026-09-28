import type { LabOrderDetail } from "../doctor/types";

/** Limits from EnterResultsSchema (docs §5.7): 1–50 entries, each result trimmed 1–2000 chars. */
export const RESULT_MAX = 2000;
export const RESULTS_MAX_ENTRIES = 50;

export interface ResultEntry {
  itemId: string;
  result: string;
}

type Item = LabOrderDetail["items"][number];

/** Form values keyed by item id, starting from the saved results (overwritable before completion). */
export function resultsFormFrom(items: readonly Item[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.id, item.result ?? ""]));
}

/** The field's current text; a field missing from `values` counts as unchanged (its saved result). */
function currentValue(item: Item, values: Record<string, string>): string {
  return (values[item.id] ?? item.result ?? "").trim();
}

/** Whether any field differs from its saved result (after trimming). */
export function hasUnsavedResults(items: readonly Item[], values: Record<string, string>): boolean {
  return items.some((item) => currentValue(item, values) !== (item.result ?? "").trim());
}

/**
 * Validates the results form and builds the request entries. Only
 * changed fields are sent: a new result, or a different one replacing a
 * saved result. Blank fields without a saved result are skipped (they
 * can be filled later). A saved result cannot be cleared — the backend
 * requires 1–2000 characters — so blanking one is an error.
 */
export function validateResultsForm(
  items: readonly Item[],
  values: Record<string, string>
): { ok: true; results: ResultEntry[] } | { ok: false; errors: Record<string, string>; error?: string } {
  const errors: Record<string, string> = {};
  const results: ResultEntry[] = [];

  for (const item of items) {
    const value = currentValue(item, values);
    const saved = (item.result ?? "").trim();
    if (value === saved) continue;
    if (value === "") {
      errors[item.id] = "A saved result can’t be cleared. Enter the corrected result.";
      continue;
    }
    if (value.length > RESULT_MAX) {
      errors[item.id] = `Keep the result under ${RESULT_MAX} characters.`;
      continue;
    }
    results.push({ itemId: item.id, result: value });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (results.length === 0) return { ok: false, errors, error: "Enter or change at least one result before saving." };
  if (results.length > RESULTS_MAX_ENTRIES) {
    return { ok: false, errors, error: `Save at most ${RESULTS_MAX_ENTRIES} results at a time.` };
  }
  return { ok: true, results };
}
