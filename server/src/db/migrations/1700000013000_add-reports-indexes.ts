import { MigrationBuilder } from "node-pg-migrate";

/**
 * Purely additive index migration for Reports V1. No table/column
 * changes, no data changes — Dashboard only ever needed a single
 * CURRENT_DATE point-query per table, but Reports scans arbitrary
 * date ranges across full table history, so these four are the
 * first case in this project where the index gap is real rather
 * than a footnote. Exactly the four columns actually used by the
 * approved V1 report scope — nothing else.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex("patients", "created_at");
  pgm.createIndex("invoices", "created_at");
  pgm.createIndex("payments", "paid_at");
  pgm.createIndex("purchases", "purchase_date");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex("purchases", "purchase_date");
  pgm.dropIndex("payments", "paid_at");
  pgm.dropIndex("invoices", "created_at");
  pgm.dropIndex("patients", "created_at");
}
