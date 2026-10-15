import { MigrationBuilder } from "node-pg-migrate";

/**
 * Reception can send a registered patient straight to the lab (a
 * lab-only visit). Such an order has no consultation, so
 * laboratory_orders.consultation_id must be allowed to be NULL.
 * Existing rows are untouched; the foreign key stays in place.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.alterColumn("laboratory_orders", "consultation_id", { notNull: false });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // Direct-from-reception orders cannot satisfy NOT NULL; refuse rather than guess.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM laboratory_orders WHERE consultation_id IS NULL) THEN
        RAISE EXCEPTION 'Cannot roll back: lab orders without a consultation exist';
      END IF;
    END $$;
  `);
  pgm.alterColumn("laboratory_orders", "consultation_id", { notNull: true });
}
