/** docs/api-inventory.md §4 InventoryItem and §5.9. */
export interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  quantityOnHand: number;
}

/** Body of POST /inventory/items. Strict: only these keys. */
export interface CreateInventoryItemBody {
  name: string;
  unit: string;
  quantityOnHand: number;
}
