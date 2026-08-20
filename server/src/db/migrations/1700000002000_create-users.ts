import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createExtension("pgcrypto", { ifNotExists: true }); // for gen_random_uuid()

  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    full_name: { type: "varchar(255)", notNull: true },
    // Login identifier — clinic staff typically use phone, not email.
    username: { type: "varchar(100)", notNull: true, unique: true },
    phone: { type: "varchar(32)" },
    email: { type: "varchar(255)" },
    password_hash: { type: "varchar(255)", notNull: true },
    role_id: {
      type: "integer",
      notNull: true,
      references: "roles",
      onDelete: "RESTRICT",
    },
    // Deactivation, never deletion — historical records must stay
    // attributable to the original user (Phase 1 §25/§27).
    is_active: { type: "boolean", notNull: true, default: true },
    // Nullable, single-clinic-clinic_id-ready for future SaaS
    // multi-tenancy per Phase 1 §46, defaults to null (one clinic) in V1.
    clinic_id: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("users", "role_id");
  pgm.createIndex("users", "is_active");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("users");
}
