import { MigrationBuilder } from "node-pg-migrate";

/**
 * Schema matches what connect-pg-simple expects. We create it
 * explicitly via migration (rather than letting the library
 * auto-create it) so schema changes are tracked like everything else.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("session", {
    sid: { type: "varchar", notNull: true, primaryKey: true },
    sess: { type: "json", notNull: true },
    expire: { type: "timestamp(6)", notNull: true },
  });

  pgm.createIndex("session", "expire", { name: "idx_session_expire" });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("session");
}
