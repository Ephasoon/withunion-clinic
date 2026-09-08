import { pool } from "../../config/db";
import { AppError } from "../../utils/appError";
import { CreateInventoryItemInput } from "./inventory.schema";

export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  quantityOnHand: number;
}

interface InventoryItemRow {
  id: string;
  name: string;
  unit: string;
  quantity_on_hand: number;
}

function toInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    quantityOnHand: row.quantity_on_hand,
  };
}

/**
 * Owner-only stock creation. No update/adjustment/restock endpoint
 * exists in V1 (approved scope) — a duplicate normalized name is
 * always a mistake, not a restock, so it's rejected rather than
 * silently topping up quantity_on_hand.
 */
export async function createInventoryItem(input: CreateInventoryItemInput): Promise<InventoryItem> {
  const existing = await pool.query(
    `SELECT 1 FROM pharmacy_inventory_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
    [input.name]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new AppError(409, "INVENTORY_ITEM_ALREADY_EXISTS", `An inventory item named "${input.name}" already exists`);
  }

  const result = await pool.query<InventoryItemRow>(
    `INSERT INTO pharmacy_inventory_items (name, unit, quantity_on_hand) VALUES ($1, $2, $3) RETURNING *`,
    [input.name, input.unit, input.quantityOnHand]
  );
  return toInventoryItem(result.rows[0]);
}

/**
 * Minimal listing — id/name/unit/quantityOnHand only, no filtering,
 * no pagination, per the approved V1 scope. Ordered by name for a
 * predictable, scannable list in the (future) dispensing UI.
 */
export async function listInventoryItems(): Promise<InventoryItem[]> {
  const result = await pool.query<InventoryItemRow>(`SELECT * FROM pharmacy_inventory_items ORDER BY name ASC`);
  return result.rows.map(toInventoryItem);
}

export async function getInventoryItemById(id: string): Promise<InventoryItem | null> {
  const result = await pool.query<InventoryItemRow>(`SELECT * FROM pharmacy_inventory_items WHERE id = $1`, [id]);
  return result.rows[0] ? toInventoryItem(result.rows[0]) : null;
}