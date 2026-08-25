import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("visits", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    patient_id: {
      type: "uuid",
      notNull: true,
      references: "patients",
      onDelete: "RESTRICT",
    },
    // Matches the state graph in Phase 1 blueprint §4.1 and the
    // role-controlled transition table in §4.4 (modules/roles/roles.ts
    // QUEUE_TRANSITIONS). Not a DB enum — the state machine is
    // enforced in application code so new statuses don't require a
    // type migration.
    status: { type: "varchar(32)", notNull: true, default: "REGISTERED" },
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    clinic_id: { type: "uuid" }, // nullable, reserved for future multi-tenancy
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz" },
    cancelled_at: { type: "timestamptz" },
    cancel_reason: { type: "text" },
  });

  pgm.createIndex("visits", "patient_id");
  pgm.createIndex("visits", "status");
  pgm.createIndex("visits", "created_at");

  // Append-only transition ledger — the audit trail for the state
  // machine itself, separate from the general audit_logs table.
  // Every status change (including visit creation, which is the
  // first event) gets a row here.
  pgm.createTable("queue_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: {
      type: "uuid",
      notNull: true,
      references: "visits",
      onDelete: "CASCADE",
    },
    from_status: { type: "varchar(32)" }, // nullable — the creation event has no "from"
    to_status: { type: "varchar(32)", notNull: true },
    changed_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    reason: { type: "text" }, // required (enforced in app code) for CANCELLED
    changed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("queue_events", "visit_id");
  pgm.createIndex("queue_events", "changed_at");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("queue_events");
  pgm.dropTable("visits");
}
