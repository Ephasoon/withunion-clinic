import type { CreateSupplierBody, Supplier, UpdateSupplierBody } from "./types";

/** Limits from CreateSupplierSchema / UpdateSupplierSchema (docs §5.14). All text is trimmed by the backend. */
export const SUPPLIER_LIMITS = { name: 255, contactPerson: 255, phone: 32, email: 255, address: 2000 } as const;

/** A loose "something@something.something" check; the backend's email rule is the final word. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SupplierValues {
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
}

export type SupplierErrors = Partial<Record<keyof SupplierValues, string>>;

const OPTIONAL_FIELDS = ["contactPerson", "phone", "email", "address"] as const;

export const EMPTY_SUPPLIER: SupplierValues = { name: "", contactPerson: "", phone: "", email: "", address: "" };

/** The form's starting values for an existing supplier (null fields become ""). */
export function supplierValues(supplier: Supplier): SupplierValues {
  return {
    name: supplier.name,
    contactPerson: supplier.contactPerson ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    address: supplier.address ?? "",
  };
}

/** Field errors for the values as typed. Supplier names are NOT unique, so there is no duplicate check. */
export function validateSupplierValues(values: SupplierValues): SupplierErrors {
  const errors: SupplierErrors = {};
  const name = values.name.trim();
  if (name === "") errors.name = "Enter the supplier’s name.";
  else if (name.length > SUPPLIER_LIMITS.name) errors.name = `At most ${SUPPLIER_LIMITS.name} characters.`;
  for (const key of OPTIONAL_FIELDS) {
    if (values[key].trim().length > SUPPLIER_LIMITS[key]) errors[key] = `At most ${SUPPLIER_LIMITS[key]} characters.`;
  }
  const email = values.email.trim();
  if (!errors.email && email !== "" && !EMAIL.test(email)) errors.email = "Enter a valid email address, or leave it blank.";
  return errors;
}

/** POST /suppliers body: name plus only the optional fields that were filled in. */
export function buildCreateSupplier(
  values: SupplierValues
): { ok: true; body: CreateSupplierBody } | { ok: false; errors: SupplierErrors } {
  const errors = validateSupplierValues(values);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: CreateSupplierBody = { name: values.name.trim() };
  for (const key of OPTIONAL_FIELDS) {
    const value = values[key].trim();
    if (value !== "") body[key] = value;
  }
  return { ok: true, body };
}

export const NO_CHANGES_MESSAGE = "Change at least one field (details or active status) before saving.";

/**
 * PATCH /suppliers/:id body with only what changed (compared after
 * trimming, as the backend trims). The backend requires at least one
 * field, via a refine with no path — its error carries no field details —
 * so "nothing changed" is caught here with a clear message.
 *
 * Fields can't be set to null (docs §7.6). A cleared contact, phone or
 * address is sent as "" (stored as an empty string); a cleared email is
 * refused here, because "" fails the backend's email rule — an email can
 * be changed but never removed.
 */
export function buildSupplierPatch(
  original: Supplier,
  draft: SupplierValues & { isActive: boolean }
): { ok: true; body: UpdateSupplierBody } | { ok: false; errors: SupplierErrors; message?: string } {
  const errors = validateSupplierValues(draft);
  const hadEmail = (original.email ?? "") !== "";
  if (!errors.email && hadEmail && draft.email.trim() === "") {
    errors.email = "An email can be changed but not removed. Enter a new address or keep the current one.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const current = supplierValues(original);
  const body: UpdateSupplierBody = {};
  const name = draft.name.trim();
  if (name !== current.name) body.name = name;
  for (const key of OPTIONAL_FIELDS) {
    const value = draft[key].trim();
    if (value !== current[key]) body[key] = value;
  }
  if (draft.isActive !== original.isActive) body.isActive = draft.isActive;
  if (Object.keys(body).length === 0) return { ok: false, errors: {}, message: NO_CHANGES_MESSAGE };
  return { ok: true, body };
}
