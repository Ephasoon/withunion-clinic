import { MigrationBuilder } from "node-pg-migrate";

/**
 * Charge name links — Billing's saved answers to "which price-list item
 * is this medicine / lab test charged as?". name_key is the normalized
 * name (utils/chargeName.ts), one link per name. A new table only; no
 * existing table is touched. Links point at price-list items, which are
 * deactivated rather than deleted, so ON DELETE RESTRICT never blocks
 * normal use.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("charge_name_links", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name_key: { type: "text", notNull: true },
    price_list_item_id: { type: "uuid", notNull: true, references: "price_list_items", onDelete: "RESTRICT" },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("charge_name_links", "name_key", {
    unique: true,
    name: "charge_name_links_name_key_idx",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("charge_name_links");
}
