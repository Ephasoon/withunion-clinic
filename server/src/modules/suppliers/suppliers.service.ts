import { pool } from "../../config/db";
import { AppError } from "../../utils/appError";
import { CreateSupplierInput, UpdateSupplierInput } from "./suppliers.schema";

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

interface SupplierRow {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function toSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    contactPerson: row.contact_person,
    phone: row.phone,
    email: row.email,
    address: row.address,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSupplier(input: CreateSupplierInput): Promise<Supplier> {
  // No uniqueness check on name — deliberately, per the approved
  // decision that two suppliers may legitimately share a name.
  const result = await pool.query<SupplierRow>(
    `INSERT INTO suppliers (name, contact_person, phone, email, address)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.name, input.contactPerson ?? null, input.phone ?? null, input.email ?? null, input.address ?? null]
  );
  return toSupplier(result.rows[0]);
}

export async function listSuppliers(): Promise<Supplier[]> {
  const result = await pool.query<SupplierRow>(`SELECT * FROM suppliers ORDER BY name ASC`);
  return result.rows.map(toSupplier);
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const result = await pool.query<SupplierRow>(`SELECT * FROM suppliers WHERE id = $1`, [id]);
  return result.rows[0] ? toSupplier(result.rows[0]) : null;
}

export async function updateSupplier(id: string, input: UpdateSupplierInput): Promise<Supplier> {
  const existing = await getSupplierById(id);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Supplier not found");
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const columnMap: Record<string, string> = {
    name: "name",
    contactPerson: "contact_person",
    phone: "phone",
    email: "email",
    address: "address",
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

  const result = await pool.query<SupplierRow>(
    `UPDATE suppliers SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return toSupplier(result.rows[0]);
}
