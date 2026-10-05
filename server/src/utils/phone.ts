/**
 * The one normalization for matching patient phone numbers, so that
 * "0935259622", "+251 935 259 622" and "0935 259 622" are the same
 * number:
 *
 *   1. strip every character that is not an ASCII digit 0–9 (spaces,
 *      unicode spaces, "+", "-", parentheses, dots …);
 *   2. drop a leading "251" (the country code), then a single leading
 *      "0" (the national trunk prefix) — so "+251 (0) 935…" matches too.
 *
 * Returns null — "no phone", which never conflicts — when nothing or
 * fewer than MIN_PHONE_DIGITS digits remain (blank input, "+", "0",
 * "251", or an obviously incomplete number). Matching is exact
 * equality of the results.
 *
 * PHONE_NORMALIZE_SQL is the same rule as a PostgreSQL expression; the
 * two must stay identical (tests/patients.test.ts checks them against
 * each other on the unit-test inputs).
 */
export const MIN_PHONE_DIGITS = 6;

export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const normalized = raw
    .replace(/[^0-9]/g, "")
    .replace(/^251/, "")
    .replace(/^0/, "");
  return normalized.length >= MIN_PHONE_DIGITS ? normalized : null;
}

/**
 * SQL form of normalizePhone() for a column or expression, without the
 * MIN_PHONE_DIGITS cut-off: comparisons are always against a value
 * normalizePhone() returned (never null, so at least MIN_PHONE_DIGITS
 * long), so short stored values simply never match.
 */
export function phoneNormalizeSql(column: string): string {
  return `regexp_replace(regexp_replace(regexp_replace(${column}, '[^0-9]', '', 'g'), '^251', ''), '^0', '')`;
}
