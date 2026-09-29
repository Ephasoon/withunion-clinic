/** docs/api-inventory.md §4 Supplier and §5.14. */
export interface Supplier {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Body of POST /suppliers. Strict: only these keys; optional ones are left out when blank. */
export interface CreateSupplierBody {
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
}

/** Body of PATCH /suppliers/:id — only the fields that change; at least one. */
export interface UpdateSupplierBody extends Partial<CreateSupplierBody> {
  isActive?: boolean;
}
