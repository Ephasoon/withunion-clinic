import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { normalizeChargeName } from "../../utils/chargeName";
import { SaveChargeLinkInput } from "./charge-links.schema";

export interface ChargeNameLink {
  id: string;
  nameKey: string;
  priceListItemId: string;
  createdBy: string;
  createdAt: string;
}

interface ChargeNameLinkRow {
  id: string;
  name_key: string;
  price_list_item_id: string;
  created_by: string;
  created_at: string;
}

function toChargeNameLink(row: ChargeNameLinkRow): ChargeNameLink {
  return {
    id: row.id,
    nameKey: row.name_key,
    priceListItemId: row.price_list_item_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listChargeNameLinks(): Promise<ChargeNameLink[]> {
  const result = await pool.query<ChargeNameLinkRow>(
    `SELECT id, name_key, price_list_item_id, created_by, created_at FROM charge_name_links ORDER BY name_key ASC`
  );
  return result.rows.map(toChargeNameLink);
}

/**
 * Creates the link for the normalized name, or replaces the one that
 * exists — one link per name_key. The price-list item must exist and be
 * active; it is locked FOR SHARE so a concurrent deactivation can't
 * slip in between the check and the write. A replaced link takes the
 * saving user and time as its created_by / created_at: it records who
 * made the current choice. The upsert itself (ON CONFLICT) also covers
 * two first-time saves of the same name racing each other.
 */
export async function saveChargeNameLink(
  input: SaveChargeLinkInput,
  userId: string
): Promise<{ link: ChargeNameLink; before: ChargeNameLink | null; created: boolean }> {
  const nameKey = normalizeChargeName(input.name);

  return withTransaction(async (client: PoolClient) => {
    const item = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM price_list_items WHERE id = $1 FOR SHARE`,
      [input.priceListItemId]
    );
    if (!item.rows[0]) {
      throw new AppError(404, "NOT_FOUND", "Price list item not found");
    }
    if (!item.rows[0].is_active) {
      throw new AppError(409, "PRICE_LIST_ITEM_INACTIVE", "This price list item is inactive and can't be linked");
    }

    const existing = await client.query<ChargeNameLinkRow>(
      `SELECT id, name_key, price_list_item_id, created_by, created_at FROM charge_name_links
       WHERE name_key = $1 FOR UPDATE`,
      [nameKey]
    );

    const result = await client.query<ChargeNameLinkRow & { inserted: boolean }>(
      `INSERT INTO charge_name_links (name_key, price_list_item_id, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (name_key) DO UPDATE
         SET price_list_item_id = EXCLUDED.price_list_item_id, created_by = EXCLUDED.created_by, created_at = now()
       RETURNING id, name_key, price_list_item_id, created_by, created_at, (xmax = 0) AS inserted`,
      [nameKey, input.priceListItemId, userId]
    );

    return {
      link: toChargeNameLink(result.rows[0]),
      before: existing.rows[0] ? toChargeNameLink(existing.rows[0]) : null,
      created: result.rows[0].inserted,
    };
  });
}
