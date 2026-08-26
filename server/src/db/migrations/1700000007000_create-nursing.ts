import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Repeatable — a nurse may retake vitals (e.g. re-check BP) within
  // the same visit, so this is intentionally not unique on visit_id.
  // New fields (Phase 1 §9: "additional vital/assessment fields
  // later") are added as nullable columns via a future migration —
  // no type change needed on this table for that extensibility.
  pgm.createTable("vital_signs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: {
      type: "uuid",
      notNull: true,
      references: "visits",
      onDelete: "CASCADE",
    },
    recorded_by: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    blood_pressure_systolic: { type: "integer" },
    blood_pressure_diastolic: { type: "integer" },
    pulse_bpm: { type: "integer" },
    temperature_celsius: { type: "numeric(4,1)" },
    weight_kg: { type: "numeric(5,2)" },
    height_cm: { type: "numeric(5,1)" },
    respiratory_rate: { type: "integer" },
    oxygen_saturation_pct: { type: "integer" },
    notes: { type: "text" },
    recorded_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("vital_signs", "visit_id");

  // One per visit, per Phase 1 blueprint §2.5 — enforced with a
  // unique constraint on visit_id rather than in application code.
  pgm.createTable("nursing_assessments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: {
      type: "uuid",
      notNull: true,
      unique: true,
      references: "visits",
      onDelete: "CASCADE",
    },
    nurse_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "RESTRICT",
    },
    chief_complaint: { type: "text" },
    assessment_notes: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("nursing_assessments", "visit_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("nursing_assessments");
  pgm.dropTable("vital_signs");
}
