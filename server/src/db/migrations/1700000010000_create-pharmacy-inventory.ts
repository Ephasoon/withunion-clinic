import { MigrationBuilder } from "node-pg-migrate";

/**
 * Pharmacy V1: a minimal real-inventory foundation (Option 2 from the
 * approved design) — not a medicine catalogue, not batches/expiry/
 * suppliers. pharmacy_inventory_items is deliberately shaped to be
 * additively extensible by a future dedicated Inventory module
 * without a rename or data migration.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("pharmacy_inventory_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "varchar(255)", notNull: true },
    unit: { type: "varchar(50)", notNull: true },
    // CHECK constraint (not just Zod) per the approved decision that
    // quantityOnHand must never be negative — enforced at the DB
    // level as a last line of defense, not only in application code.
    quantity_on_hand: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "quantity_on_hand >= 0",
    },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Functional unique index on the normalized name — prevents
  // "Paracetamol" / "paracetamol " / "PARACETAMOL" from being
  // created as separate stock lines. No fuzzy matching, no
  // generated column — name itself stays exactly as entered.
  pgm.createIndex("pharmacy_inventory_items", "LOWER(TRIM(name))", {
    unique: true,
    name: "pharmacy_inventory_items_normalized_name_idx",
  });

  // Additive columns on the existing prescription_items table.
  // No existing column is altered, renamed, or removed — except
  // status itself, which MUST widen: it was defined as varchar(16)
  // back in the Consultation migration when only 'PENDING' existed,
  // and "PARTIALLY_DISPENSED" (19 characters) cannot fit in that
  // width. This is a required correction for the approved Pharmacy
  // V1 status values to work at all, not an unrelated schema change.
  pgm.alterColumn("prescription_items", "status", { type: "varchar(32)" });

  pgm.addColumns("prescription_items", {
    quantity_dispensed: {
      type: "integer",
      // CHECK allows NULL (nothing dispensed yet) or >= 0 — the
      // approved invariant that quantity_dispensed must never be
      // negative, enforced at the DB level.
      check: "quantity_dispensed IS NULL OR quantity_dispensed >= 0",
    },
    inventory_item_id: {
      type: "uuid",
      references: "pharmacy_inventory_items",
      onDelete: "RESTRICT",
    },
    dispensed_by: {
      type: "uuid",
      references: "users",
      onDelete: "RESTRICT",
    },
    dispensed_at: { type: "timestamptz" },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropColumns("prescription_items", ["quantity_dispensed", "inventory_item_id", "dispensed_by", "dispensed_at"]);
  pgm.alterColumn("prescription_items", "status", { type: "varchar(16)" });
  pgm.dropTable("pharmacy_inventory_items");
}