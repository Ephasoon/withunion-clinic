import { SUPPLIER_LIMITS, type SupplierErrors, type SupplierValues } from "./supplierForm";

export const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100 aria-[invalid=true]:border-red-500";

const FIELDS: { key: keyof SupplierValues; label: string; type?: string; hint?: string }[] = [
  { key: "name", label: "Name", hint: "Names don’t have to be unique." },
  { key: "contactPerson", label: "Contact person (optional)" },
  { key: "phone", label: "Phone (optional)", type: "tel" },
  { key: "email", label: "Email (optional)", type: "email" },
];

/** The supplier text fields shared by the create and edit forms. */
export function SupplierFields({
  idPrefix,
  values,
  errors,
  onChange,
  emailHint,
}: {
  idPrefix: string;
  values: SupplierValues;
  errors: SupplierErrors;
  onChange: (key: keyof SupplierValues, value: string) => void;
  emailHint?: string;
}) {
  return (
    <>
      {FIELDS.map((f) => {
        const hint = f.key === "email" ? emailHint : f.hint;
        return (
          <div key={f.key}>
            <label htmlFor={`${idPrefix}-${f.key}`} className="text-sm font-medium text-slate-700">
              {f.label}
            </label>
            <input
              id={`${idPrefix}-${f.key}`}
              type={f.type ?? "text"}
              maxLength={SUPPLIER_LIMITS[f.key]}
              value={values[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
              aria-invalid={errors[f.key] ? true : undefined}
              className={inputClass}
            />
            {errors[f.key] ? (
              <p className="mt-1 text-xs text-red-700">{errors[f.key]}</p>
            ) : (
              hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>
            )}
          </div>
        );
      })}
      <div>
        <label htmlFor={`${idPrefix}-address`} className="text-sm font-medium text-slate-700">
          Address (optional)
        </label>
        <textarea
          id={`${idPrefix}-address`}
          rows={3}
          maxLength={SUPPLIER_LIMITS.address}
          value={values.address}
          onChange={(e) => onChange("address", e.target.value)}
          aria-invalid={errors.address ? true : undefined}
          className={inputClass}
        />
        {errors.address && <p className="mt-1 text-xs text-red-700">{errors.address}</p>}
      </div>
    </>
  );
}

export function SupplierStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isActive ? "bg-green-100 text-green-900" : "bg-slate-200 text-slate-700"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}
