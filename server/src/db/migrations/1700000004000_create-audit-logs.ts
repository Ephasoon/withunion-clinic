import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("audit_logs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    action: { type: "varchar(64)", notNull: true }, // e.g. "login", "user.deactivate"
    entity: { type: "varchar(64)", notNull: true }, // e.g. "users"
    entity_id: { type: "varchar(64)" },
    before_value: { type: "jsonb" },
    after_value: { type: "jsonb" },
    ip_address: { type: "varchar(64)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("audit_logs", "user_id");
  pgm.createIndex("audit_logs", ["entity", "entity_id"]);
  pgm.createIndex("audit_logs", "created_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("audit_logs");
}
