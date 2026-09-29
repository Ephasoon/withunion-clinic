/** docs/api-inventory.md §4 PurchaseDetail and §5.15. */
export type PurchaseStatus = "PENDING" | "RECEIVED";

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
  /** A plain "YYYY-MM-DD" calendar date — never passed through Date. */
  purchaseDate: string;
  referenceNumber: string | null;
  notes: string | null;
  status: PurchaseStatus;
  createdBy: string;
  createdAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  /** Ordered by item name. */
  items: PurchaseItem[];
}

/** Body of POST /purchases. Strict at the top level; optional keys are left out when blank. */
export interface CreatePurchaseBody {
  supplierId: string;
  purchaseDate: string;
  referenceNumber?: string;
  notes?: string;
  items: { inventoryItemId: string; quantity: number; unitCost: number }[];
}
