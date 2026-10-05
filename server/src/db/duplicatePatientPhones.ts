/**
 * Read-only report: existing patients that share a phone number, grouped
 * by the normalized value used for the uniqueness rule (utils/phone.ts).
 * The rule only stops NEW duplicates; rows that already share a number
 * stay as they are until someone resolves them by hand. Runs in a
 * READ ONLY transaction that is rolled back — it never modifies data.
 *
 * Usage: npx tsx src/db/duplicatePatientPhones.ts
 * (uses DATABASE_URL, i.e. the dev database).
 */
import { pool } from "../config/db";
import { MIN_PHONE_DIGITS, phoneNormalizeSql } from "../utils/phone";

interface DuplicateRow {
  normalized_phone: string;
  patient_code: string;
  full_name: string;
  status: string;
  phone: string;
  created_at: Date;
}

async function report() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const result = await client.query<DuplicateRow>(
      `WITH normalized AS (
         SELECT id, patient_code, full_name, status, phone, created_at,
                ${phoneNormalizeSql("phone")} AS normalized_phone
         FROM patients
         WHERE phone IS NOT NULL
       )
       SELECT normalized_phone, patient_code, full_name, status, phone, created_at
       FROM normalized
       WHERE length(normalized_phone) >= $1
         AND normalized_phone IN (
           SELECT normalized_phone FROM normalized
           WHERE length(normalized_phone) >= $1
           GROUP BY normalized_phone HAVING COUNT(*) > 1
         )
       ORDER BY normalized_phone, created_at`,
      [MIN_PHONE_DIGITS]
    );
    await client.query("ROLLBACK");

    const groups = new Map<string, DuplicateRow[]>();
    for (const row of result.rows) {
      groups.set(row.normalized_phone, [...(groups.get(row.normalized_phone) ?? []), row]);
    }
    console.log(`${groups.size} duplicated phone number(s), ${result.rows.length} patient(s) involved.`);
    for (const [normalized, rows] of groups) {
      console.log(`\n${normalized} — ${rows.length} patients`);
      for (const r of rows) {
        console.log(
          `  ${r.patient_code}  ${r.status.padEnd(8)}  ${JSON.stringify(r.phone).padEnd(20)}  ${r.full_name}  (registered ${r.created_at.toISOString()})`
        );
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

report().catch((err) => {
  console.error("Report failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
