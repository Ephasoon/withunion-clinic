/** docs/api-inventory.md §4 PriceListItem and §5.17. */
export interface PriceListItem {
  id: string;
  name: string;
  /** JSON number, 2 dp. */
  price: number;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /price-list. Strict: only these keys. */
export interface CreatePriceListItemBody {
  name: string;
  price: number;
}

/** Body of PATCH /price-list/:id — only the fields that change; at least one. */
export interface UpdatePriceListItemBody extends Partial<CreatePriceListItemBody> {
  isActive?: boolean;
}
