/**
 * Two kinds of dates come from the backend (docs/api-inventory.md §7.3):
 *
 * - Calendar dates (Patient.dateOfBirth) are plain "YYYY-MM-DD" strings.
 *   They are handled here with string and integer arithmetic only and
 *   are never passed through `Date`, which would reinterpret them in a
 *   timezone and can shift them by a day.
 * - Timestamps (createdAt, changedAt, …) are ISO-8601 UTC instants.
 *   Those are real moments in time, so `Date` is correct for them.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Splits a "YYYY-MM-DD" string into numbers, or null if it is not a real calendar date. */
export function parseIsoDate(value: string): DateParts | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Whether `value` is a real "YYYY-MM-DD" calendar date (the same rule as the backend's z.string().date()). */
export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** Today's date on this device as "YYYY-MM-DD". Reads the clock only; no calendar date is converted. */
export function todayIsoDate(now: Date = new Date()): string {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "1990-05-14" → "14 May 1990". Unparseable input is returned unchanged. */
export function formatIsoDate(value: string): string {
  const parts = parseIsoDate(value);
  if (!parts) return value;
  return `${parts.day} ${MONTH_NAMES[parts.month - 1]} ${parts.year}`;
}

/** Whole years between a "YYYY-MM-DD" birth date and `today` ("YYYY-MM-DD"), or null if either is invalid or birth is after today. */
export function ageFromIsoDate(dateOfBirth: string, today: string): number | null {
  const birth = parseIsoDate(dateOfBirth);
  const now = parseIsoDate(today);
  if (!birth || !now) return null;
  let age = now.year - birth.year;
  if (now.month < birth.month || (now.month === birth.month && now.day < birth.day)) age -= 1;
  return age < 0 ? null : age;
}

/** An ISO timestamp as a local date and time, e.g. "28 Sept 2026, 14:05". */
export function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** An ISO timestamp as a local time of day, e.g. "14:05". */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
}
