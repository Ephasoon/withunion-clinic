import { PRICE_LIST_LIMITS, type PriceListErrors, type PriceListValues } from "./priceListForm";

export const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-100 aria-[invalid=true]:border-red-500";

const FIELDS: { key: keyof PriceListValues; label: string; inputMode?: "decimal"; maxLength?: number; hint: string }[] = [
  { key: "name", label: "Name", maxLength: PRICE_LIST_LIMITS.name, hint: "Must be unique (ignoring case and spacing)." },
  { key: "price", label: "Price", inputMode: "decimal", hint: "e.g. 150 or 150.50 — at most 2 decimals." },
];

/** The price-list fields shared by the create and edit forms. */
export function PriceListFields({
  idPrefix,
  values,
  errors,
  onChange,
}: {
  idPrefix: string;
  values: PriceListValues;
  errors: PriceListErrors;
  onChange: (key: keyof PriceListValues, value: string) => void;
}) {
  return (
    <>
      {FIELDS.map((f) => (
        <div key={f.key}>
          <label htmlFor={`${idPrefix}-${f.key}`} className="text-sm font-medium text-slate-700">
            {f.label}
          </label>
          <input
            id={`${idPrefix}-${f.key}`}
            inputMode={f.inputMode}
            maxLength={f.maxLength}
            value={values[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            aria-invalid={errors[f.key] ? true : undefined}
            className={inputClass}
          />
          {errors[f.key] ? (
            <p className="mt-1 text-xs text-red-700">{errors[f.key]}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">{f.hint}</p>
          )}
        </div>
      ))}
    </>
  );
}

export function PriceListStatusBadge({ isActive }: { isActive: boolean }) {
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
