/**
 * Money handling for billing. The API returns amounts as JSON numbers
 * already rounded to 2 dp (docs §7.5). Anything the user types is parsed
 * into whole cents from the text itself, so comparisons (e.g. "is this
 * payment above the balance?") are exact integers, never floating point.
 */

const MONEY_TEXT = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "150", "150.5", "150.50" → 15050 cents. More than 2 decimals, signs, commas or text → null. */
export function parseMoneyToCents(text: string): number | null {
  const match = MONEY_TEXT.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** An API amount (2 dp number) as whole cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Whole cents as the number the API expects (2 dp). */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** An amount for display with exactly 2 decimals and grouping, e.g. 1,250.00. No currency is assumed. */
export function formatMoney(amount: number): string {
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A balance of exactly zero — what completing requires (after the API's own 2 dp rounding). */
export function isZeroBalance(balance: number): boolean {
  return toCents(balance) === 0;
}
