import { MigrationBuilder } from "node-pg-migrate";

/**
 * Price List V1 — an owner-maintained list of named prices. A
 * standalone table: nothing else references it yet, and no existing
 * table is touched. Items are deactivated, never deleted.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("price_list_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    price: { type: "numeric(10,2)", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Functional unique index on the normalized name — same approach as
  // pharmacy_inventory_items_normalized_name_idx: "Consultation" /
  // "consultation " / "CONSULTATION" cannot coexist, while name itself
  // stays exactly as entered.
  pgm.createIndex("price_list_items", "LOWER(TRIM(name))", {
    unique: true,
    name: "price_list_items_normalized_name_idx",
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("price_list_items");
}
