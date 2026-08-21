import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("patients", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Human-readable sequential code, e.g. WU-000123. Generated
    // server-side (see patients.service.ts) — never client-supplied.
    patient_code: { type: "varchar(20)", notNull: true, unique: true },
    full_name: { type: "varchar(255)", notNull: true },
    gender: { type: "varchar(16)", notNull: true },
    date_of_birth: { type: "date" },
    // Used only when exact DOB is unknown, per Phase 1 §5.
    approximate_age: { type: "integer" },
    phone: { type: "varchar(32)" },
    address: { type: "text" },
    emergency_contact_name: { type: "varchar(255)" },
    emergency_contact_phone: { type: "varchar(32)" },
    status: { type: "varchar(16)", notNull: true, default: "active" }, // active | inactive — never deleted
    notes: { type: "text" },
    clinic_id: { type: "uuid" }, // nullable, reserved for future multi-tenancy (§46)
    created_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("patients", "phone");
  pgm.createIndex("patients", "full_name");
  pgm.createIndex("patients", "status");

  // Sequence backing the patient_code generator — kept separate from
  // the table's own id sequence so the human-readable code stays
  // stable and predictable regardless of row deletions/rollbacks.
  pgm.createSequence("patient_code_seq", { start: 1, increment: 1 });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropSequence("patient_code_seq");
  pgm.dropTable("patients");
}
