import { Pool, types } from "pg";
import { env } from "./env";

/**
 * Return DATE columns as the raw "YYYY-MM-DD" string. node-postgres's
 * default turns a DATE into a JS Date at local midnight, which then
 * serializes in UTC — e.g. 1990-05-14 becomes "1990-05-13T21:00:00.000Z"
 * on a UTC+3 server. A calendar date has no time or timezone, so it is
 * passed through untouched. Process-wide; affects DATE only (not
 * timestamptz). Must run before any query.
 */
types.setTypeParser(types.builtins.DATE, (value: string) => value);

/**
 * Single shared connection pool. All queries go through here so we
 * get consistent connection reuse, timeouts, and a single place to
 * add query logging or read/write splitting later.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // Unexpected errors on idle clients — log and let the process
  // supervisor (pm2/systemd/docker) decide whether to restart.
  // eslint-disable-next-line no-console
  console.error("Unexpected PostgreSQL pool error:", err);
});

/**
 * Run a function inside a single transaction. Any multi-row write
 * (e.g., dispensing medicine → decrementing a batch → writing a
 * stock_movement) MUST go through this helper so a partial failure
 * can never leave inventory or billing data half-updated.
 */
export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
