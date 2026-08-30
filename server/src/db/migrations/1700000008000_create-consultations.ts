import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // One row per doctor "touch" of a visit — a visit may have several
  // (initial consult, then a review after lab results come back), per
  // the approved Phase 3 decision (blueprint §2.6). Each is its own
  // recorded event, all linked to the same visit.
  pgm.createTable("consultations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: { type: "uuid", notNull: true, references: "visits", onDelete: "RESTRICT" },
    doctor_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    notes: { type: "text" },
    started_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    completed_at: { type: "timestamptz" }, // nullable — doctor can save and resume (§10)
  });
  pgm.createIndex("consultations", "visit_id");
  pgm.createIndex("consultations", "doctor_id");
  // Multiple consultations per visit are allowed (sequential doctor
  // touches, e.g. initial consult + a later review after lab
  // results) — but only one may be OPEN at a time. Enforced at the
  // database level, not just in application code, mirroring the
  // precedent set by nursing_assessments' unique(visit_id): a
  // partial unique index only applies to rows where completed_at is
  // still null, so any number of completed rows can coexist.
  pgm.createIndex("consultations", "visit_id", {
    name: "consultations_one_open_per_visit",
    unique: true,
    where: "completed_at IS NULL",
  });

  pgm.createTable("diagnoses", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    consultation_id: { type: "uuid", notNull: true, references: "consultations", onDelete: "RESTRICT" },
    description: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("diagnoses", "consultation_id");

  // Creation-only in this phase — no result-entry columns. The
  // laboratory_results table and the fulfillment workflow (lab
  // technician side) are out of scope until the Laboratory phase.
  pgm.createTable("laboratory_orders", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: { type: "uuid", notNull: true, references: "visits", onDelete: "RESTRICT" },
    consultation_id: { type: "uuid", notNull: true, references: "consultations", onDelete: "RESTRICT" },
    requested_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    status: { type: "varchar(16)", notNull: true, default: "REQUESTED" },
    requested_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("laboratory_orders", "visit_id");
  pgm.createIndex("laboratory_orders", "consultation_id");

  pgm.createTable("laboratory_order_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    order_id: { type: "uuid", notNull: true, references: "laboratory_orders", onDelete: "CASCADE" },
    test_name: { type: "varchar(255)", notNull: true },
  });
  pgm.createIndex("laboratory_order_items", "order_id");

  // Creation-only in this phase — dispensing/inventory deduction is
  // out of scope until the Pharmacy phase. medicine_name is
  // deliberately free text: the real `medicines` inventory table
  // doesn't exist until Phase 5 inventory work, and doctor
  // prescribing must not be blocked on that (approved decision).
  // A future migration adds a proper medicine_id FK and reconciles
  // existing free-text rows once that table exists.
  pgm.createTable("prescriptions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: { type: "uuid", notNull: true, references: "visits", onDelete: "RESTRICT" },
    consultation_id: { type: "uuid", notNull: true, references: "consultations", onDelete: "RESTRICT" },
    doctor_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("prescriptions", "visit_id");
  pgm.createIndex("prescriptions", "consultation_id");

  pgm.createTable("prescription_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    prescription_id: { type: "uuid", notNull: true, references: "prescriptions", onDelete: "CASCADE" },
    medicine_name: { type: "varchar(255)", notNull: true }, // free text — see note above
    strength: { type: "varchar(100)" },
    dosage: { type: "varchar(100)" },
    frequency: { type: "varchar(100)" },
    duration: { type: "varchar(100)" },
    quantity_prescribed: { type: "integer" },
    status: { type: "varchar(16)", notNull: true, default: "PENDING" },
  });
  pgm.createIndex("prescription_items", "prescription_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("prescription_items");
  pgm.dropTable("prescriptions");
  pgm.dropTable("laboratory_order_items");
  pgm.dropTable("laboratory_orders");
  pgm.dropTable("diagnoses");
  pgm.dropTable("consultations");
}
