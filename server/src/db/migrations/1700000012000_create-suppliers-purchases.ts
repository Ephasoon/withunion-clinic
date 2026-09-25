import { MigrationBuilder } from "node-pg-migrate";

/**
 * Suppliers & Purchasing V1 — completes the operational side of
 * inventory: Supplier -> Purchase -> Purchase Items -> stock
 * increase on receipt. No batch/expiry/FEFO, no stock ledger table
 * (audit_logs already serves that role, matching Pharmacy's
 * inventory_item.stock_decrement precedent), no supplier
 * payments/accounting.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("suppliers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "varchar(255)", notNull: true }, // deliberately NOT unique — two suppliers can share a name
    contact_person: { type: "varchar(255)" },
    phone: { type: "varchar(32)" },
    email: { type: "varchar(255)" },
    address: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("purchases", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    supplier_id: { type: "uuid", notNull: true, references: "suppliers", onDelete: "RESTRICT" },
    // Explicit, owner-entered date of the purchase/delivery —
    // deliberately NOT defaulted to now(), since a purchase is often
    // recorded after the fact. created_at (below) separately tracks
    // when the record itself was created, per the approved decision.
    purchase_date: { type: "date", notNull: true },
    reference_number: { type: "varchar(100)" },
    notes: { type: "text" },
    // PENDING | RECEIVED — mirrors invoices.status's OPEN/PAID shape.
    status: { type: "varchar(16)", notNull: true, default: "PENDING" },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    received_by: { type: "uuid", references: "users", onDelete: "RESTRICT" },
    received_at: { type: "timestamptz" },
  });
  pgm.createIndex("purchases", "supplier_id");

  pgm.createTable("purchase_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    purchase_id: { type: "uuid", notNull: true, references: "purchases", onDelete: "CASCADE" },
    inventory_item_id: { type: "uuid", notNull: true, references: "pharmacy_inventory_items", onDelete: "RESTRICT" },
    quantity: { type: "integer", notNull: true, check: "quantity > 0" },
    unit_cost: { type: "numeric(10,2)", notNull: true, check: "unit_cost >= 0" },
  });
  pgm.createIndex("purchase_items", "purchase_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("purchase_items");
  pgm.dropTable("purchases");
  pgm.dropTable("suppliers");
}
