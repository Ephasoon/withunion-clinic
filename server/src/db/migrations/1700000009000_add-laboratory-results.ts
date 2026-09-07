import { MigrationBuilder } from "node-pg-migrate";

/**
 * Laboratory V1: extends the existing laboratory_order_items table
 * with the minimum fields needed for a plain-text result — no
 * separate laboratory_results table, no reference ranges, no
 * abnormal-flag engine, per the approved V1 scope. result is
 * nullable (a test starts with no result); result_entered_by/at are
 * populated together whenever a result is written.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumns("laboratory_order_items", {
    result: { type: "text" },
    result_entered_by: {
      type: "uuid",
      references: "users",
      onDelete: "RESTRICT",
    },
    result_entered_at: { type: "timestamptz" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("laboratory_order_items", ["result", "result_entered_by", "result_entered_at"]);
}