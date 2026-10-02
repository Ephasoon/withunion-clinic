import { pool } from "../../config/db";
import { AppError } from "../../utils/appError";
import { CreatePriceListItemInput, UpdatePriceListItemInput } from "./price-list.schema";

export interface PriceListItem {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface PriceListItemRow {
  id: string;
  name: string;
  price: string; // NUMERIC comes back from pg as a string
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toPriceListItem(row: PriceListItemRow): PriceListItem {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Same normalized-name duplicate check as createInventoryItem().
 * excludeId lets an item keep (or re-case) its own name on update.
 */
async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  const existing = await pool.query(
    `SELECT 1 FROM price_list_items WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND ($2::uuid IS NULL OR id <> $2)`,
    [name, excludeId ?? null]
  );
  if ((existing.rowCount ?? 0) > 0) {
    throw new AppError(409, "PRICE_LIST_ITEM_ALREADY_EXISTS", `A price list item named "${name}" already exists`);
  }
}

export async function createPriceListItem(input: CreatePriceListItemInput, createdBy: string): Promise<PriceListItem> {
  await assertNameAvailable(input.name);

  const result = await pool.query<PriceListItemRow>(
    `INSERT INTO price_list_items (name, price, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [input.name, input.price, createdBy]
  );
  return toPriceListItem(result.rows[0]);
}

export async function listPriceListItems(): Promise<PriceListItem[]> {
  const result = await pool.query<PriceListItemRow>(`SELECT * FROM price_list_items ORDER BY name ASC`);
  return result.rows.map(toPriceListItem);
}

export async function getPriceListItemById(id: string): Promise<PriceListItem | null> {
  const result = await pool.query<PriceListItemRow>(`SELECT * FROM price_list_items WHERE id = $1`, [id]);
  return result.rows[0] ? toPriceListItem(result.rows[0]) : null;
}

export async function updatePriceListItem(id: string, input: UpdatePriceListItemInput): Promise<PriceListItem> {
  const existing = await getPriceListItemById(id);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Price list item not found");
  }
  if (input.name !== undefined) {
    await assertNameAvailable(input.name, id);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const columnMap: Record<string, string> = {
    name: "name",
    price: "price",
    isActive: "is_active",
  };

  for (const [key, column] of Object.entries(columnMap)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      fields.push(`${column} = $${i}`);
      values.push(value);
      i++;
    }
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await pool.query<PriceListItemRow>(
    `UPDATE price_list_items SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return toPriceListItem(result.rows[0]);
}
