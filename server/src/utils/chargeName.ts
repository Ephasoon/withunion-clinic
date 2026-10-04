/**
 * The one normalization for matching a charge name (a medicine or lab
 * test name) to a price-list item: trimmed, every run of whitespace —
 * including unicode spaces such as the no-break space — collapsed to a
 * single ASCII space, and lowercased. Matching is exact equality of the
 * results; nothing fuzzy or partial. The frontend's copy
 * (features/billing/chargeSuggestions.ts) must stay identical.
 */
export function normalizeChargeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
