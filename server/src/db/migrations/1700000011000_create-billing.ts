import { MigrationBuilder } from "node-pg-migrate";

/**
 * Billing V1: manual invoice entry closing the existing
 * WAITING_FOR_BILLING -> COMPLETED transition. No price catalogue —
 * Reception enters description/quantity/unitPrice by hand. total,
 * amountPaid, and balance are deliberately NOT stored — always
 * derived at read time from invoice_items and payments, per the
 * same "derive, don't duplicate" discipline already used for
 * visits.status vs. queue_events.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("invoices", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    visit_id: {
      type: "uuid",
      notNull: true,
      references: "visits",
      onDelete: "RESTRICT",
      unique: true, // exactly one invoice per visit in V1
    },
    cashier_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    discount: { type: "numeric(10,2)", notNull: true, default: 0, check: "discount >= 0" },
    status: { type: "varchar(16)", notNull: true, default: "OPEN" }, // OPEN | PAID only
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("invoices", "visit_id");

  pgm.createTable("invoice_items", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    invoice_id: { type: "uuid", notNull: true, references: "invoices", onDelete: "CASCADE" },
    description: { type: "varchar(255)", notNull: true },
    quantity: { type: "integer", notNull: true, default: 1, check: "quantity > 0" },
    unit_price: { type: "numeric(10,2)", notNull: true, check: "unit_price >= 0" },
    // No stored line total — quantity * unit_price computed at read time.
  });
  pgm.createIndex("invoice_items", "invoice_id");

  pgm.createTable("payments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    invoice_id: { type: "uuid", notNull: true, references: "invoices", onDelete: "RESTRICT" },
    amount: { type: "numeric(10,2)", notNull: true, check: "amount > 0" },
    method: { type: "varchar(20)", notNull: true }, // cash | bank_transfer | other
    recorded_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    paid_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("payments", "invoice_id");
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("payments");
  pgm.dropTable("invoice_items");
  pgm.dropTable("invoices");
}
