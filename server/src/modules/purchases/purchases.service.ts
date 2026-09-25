import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { CreatePurchaseInput } from "./purchases.schema";

export interface PurchaseItem {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseDetail {
  id: string;
  supplierId: string;
  supplierName: string;
  purchaseDate: string;
  referenceNumber: string | null;
  notes: string | null;
  status: string;
  createdBy: string;
  createdAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  items: PurchaseItem[];
}

interface PurchaseRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  purchase_date: string;
  reference_number: string | null;
  notes: string | null;
  status: string;
  created_by: string;
  created_at: string;
  received_by: string | null;
  received_at: string | null;
}

interface PurchaseItemRow {
  id: string;
  inventory_item_id: string;
  inventory_item_name: string;
  quantity: number;
  unit_cost: string;
}

const PURCHASE_SELECT = `
  SELECT p.id, p.supplier_id, s.name AS supplier_name, p.purchase_date, p.reference_number,
         p.notes, p.status, p.created_by, p.created_at, p.received_by, p.received_at
  FROM purchases p
  JOIN suppliers s ON s.id = p.supplier_id
`;

function toPurchaseItem(row: PurchaseItemRow): PurchaseItem {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    inventoryItemName: row.inventory_item_name,
    quantity: row.quantity,
    unitCost: Number(row.unit_cost),
  };
}

async function getItemsForPurchase(purchaseId: string): Promise<PurchaseItem[]> {
  const result = await pool.query<PurchaseItemRow>(
    `SELECT pi.id, pi.inventory_item_id, ii.name AS inventory_item_name, pi.quantity, pi.unit_cost
     FROM purchase_items pi
     JOIN pharmacy_inventory_items ii ON ii.id = pi.inventory_item_id
     WHERE pi.purchase_id = $1
     ORDER BY ii.name ASC`,
    [purchaseId]
  );
  return result.rows.map(toPurchaseItem);
}

async function toDetail(row: PurchaseRow): Promise<PurchaseDetail> {
  const items = await getItemsForPurchase(row.id);
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    purchaseDate: row.purchase_date,
    referenceNumber: row.reference_number,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    receivedBy: row.received_by,
    receivedAt: row.received_at,
    items,
  };
}

export async function getPurchaseDetail(id: string): Promise<PurchaseDetail | null> {
  const result = await pool.query<PurchaseRow>(`${PURCHASE_SELECT} WHERE p.id = $1`, [id]);
  if (!result.rows[0]) return null;
  return toDetail(result.rows[0]);
}

export async function listPurchases(): Promise<PurchaseDetail[]> {
  const result = await pool.query<PurchaseRow>(`${PURCHASE_SELECT} ORDER BY p.created_at DESC`);
  return Promise.all(result.rows.map(toDetail));
}

export async function createPurchase(input: CreatePurchaseInput, createdBy: string): Promise<PurchaseDetail> {
  const supplierResult = await pool.query(`SELECT 1 FROM suppliers WHERE id = $1`, [input.supplierId]);
  if ((supplierResult.rowCount ?? 0) === 0) {
    throw new AppError(404, "NOT_FOUND", "Supplier not found");
  }

  const purchaseId = await withTransaction(async (client: PoolClient) => {
    const purchaseResult = await client.query<{ id: string }>(
      `INSERT INTO purchases (supplier_id, purchase_date, reference_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.supplierId, input.purchaseDate, input.referenceNumber ?? null, input.notes ?? null, createdBy]
    );
    const id = purchaseResult.rows[0].id;

    for (const item of input.items) {
      const itemExists = await client.query(`SELECT 1 FROM pharmacy_inventory_items WHERE id = $1`, [
        item.inventoryItemId,
      ]);
      if ((itemExists.rowCount ?? 0) === 0) {
        throw new AppError(400, "INVALID_INVENTORY_ITEM", `Inventory item ${item.inventoryItemId} does not exist`);
      }
      await client.query(
        `INSERT INTO purchase_items (purchase_id, inventory_item_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)`,
        [id, item.inventoryItemId, item.quantity, item.unitCost]
      );
    }

    return id;
  });

  return (await getPurchaseDetail(purchaseId))!;
}

export interface StockIncrementRecord {
  inventoryItemId: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
}

export interface ReceivePurchaseOutcome {
  purchase: PurchaseDetail;
  increments: StockIncrementRecord[];
}

export async function receivePurchase(purchaseId: string, receivedBy: string): Promise<ReceivePurchaseOutcome> {
  const increments: StockIncrementRecord[] = [];

  await withTransaction(async (client: PoolClient) => {
    const lockResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM purchases WHERE id = $1 FOR UPDATE`,
      [purchaseId]
    );
    const purchaseRow = lockResult.rows[0];
    if (!purchaseRow) {
      throw new AppError(404, "NOT_FOUND", "Purchase not found");
    }
    if (purchaseRow.status !== "PENDING") {
      throw new AppError(409, "PURCHASE_ALREADY_RECEIVED", `Purchase is already ${purchaseRow.status}`);
    }

    const itemsResult = await client.query<{ inventory_item_id: string; quantity: number }>(
      `SELECT inventory_item_id, quantity FROM purchase_items WHERE purchase_id = $1`,
      [purchaseId]
    );

    for (const item of itemsResult.rows) {
      const updateResult = await client.query<{ quantity_on_hand: number }>(
        `UPDATE pharmacy_inventory_items
         SET quantity_on_hand = quantity_on_hand + $1, updated_at = now()
         WHERE id = $2
         RETURNING quantity_on_hand`,
        [item.quantity, item.inventory_item_id]
      );
      const stockAfter = updateResult.rows[0].quantity_on_hand;
      increments.push({
        inventoryItemId: item.inventory_item_id,
        quantity: item.quantity,
        stockBefore: stockAfter - item.quantity,
        stockAfter,
      });
    }

        await client.query(
      `UPDATE purchases SET status = 'RECEIVED', received_by = $1, received_at = now() WHERE id = $2`,
      [receivedBy, purchaseId]
    );
  });

  return { purchase: (await getPurchaseDetail(purchaseId))!, increments };
}
