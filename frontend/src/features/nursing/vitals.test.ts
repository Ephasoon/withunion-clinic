import { describe, expect, it } from "vitest";
import type { VitalSignsResponse } from "./types";
import {
  EMPTY_VITALS_FORM,
  formatBloodPressure,
  formatMeasurement,
  parseNumericString,
  toVitalSigns,
  validateVitalsForm,
  VITALS_FIELDS,
  type VitalsFormValues,
} from "./vitals";

const form = (overrides: Partial<VitalsFormValues>): VitalsFormValues => ({ ...EMPTY_VITALS_FORM, ...overrides });

describe("VITALS_FIELDS", () => {
  it("matches the backend ranges in docs §5.5", () => {
    const ranges = Object.fromEntries(VITALS_FIELDS.map((f) => [f.key, [f.min, f.max]]));
    expect(ranges).toEqual({
      bloodPressureSystolic: [30, 300],
      bloodPressureDiastolic: [20, 200],
      pulseBpm: [20, 300],
      temperatureCelsius: [25, 45],
      respiratoryRate: [4, 80],
      oxygenSaturationPct: [30, 100],
      weightKg: [0.5, 400],
      heightCm: [20, 250],
    });
  });
});

describe("validateVitalsForm — ranges", () => {
  it("accepts every boundary value", () => {
    for (const field of VITALS_FIELDS) {
      expect(validateVitalsForm(form({ [field.key]: String(field.min) })).ok, `${field.key} min`).toBe(true);
      expect(validateVitalsForm(form({ [field.key]: String(field.max) })).ok, `${field.key} max`).toBe(true);
    }
  });

  it("rejects values just outside each range", () => {
    const outside: Partial<VitalsFormValues> = {
      bloodPressureSystolic: "29",
      bloodPressureDiastolic: "201",
      pulseBpm: "301",
      temperatureCelsius: "45.1",
      respiratoryRate: "3",
      oxygenSaturationPct: "101",
      weightKg: "0.49",
      heightCm: "250.1",
    };
    const result = validateVitalsForm(form(outside));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(Object.keys(outside).sort());
  });

  it("catches a typo like 3700 for temperature", () => {
    const result = validateVitalsForm(form({ temperatureCelsius: "3700" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.temperatureCelsius).toBe("Must be between 25 and 45 °C.");
  });
});

describe("validateVitalsForm — number format", () => {
  it("rejects decimals in whole-number fields", () => {
    for (const key of ["bloodPressureSystolic", "pulseBpm", "respiratoryRate", "oxygenSaturationPct"] as const) {
      const result = validateVitalsForm(form({ [key]: "98.5" }));
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.errors[key]).toBe("Enter a whole number.");
    }
  });

  it("rejects more decimal places than the database stores", () => {
    expect(validateVitalsForm(form({ temperatureCelsius: "37.55" })).ok).toBe(false);
    expect(validateVitalsForm(form({ heightCm: "170.25" })).ok).toBe(false);
    expect(validateVitalsForm(form({ weightKg: "70.255" })).ok).toBe(false);
    expect(validateVitalsForm(form({ weightKg: "70.25" })).ok).toBe(true);
  });

  it("rejects text, negatives, commas and exponents", () => {
    for (const bad of ["abc", "-37", "37,5", "3e1", ".5", "37."]) {
      expect(validateVitalsForm(form({ temperatureCelsius: bad })).ok, bad).toBe(false);
    }
  });
});

describe("validateVitalsForm — request body", () => {
  it("sends numbers, omits blank fields and trims notes", () => {
    const result = validateVitalsForm(
      form({ bloodPressureSystolic: "120", bloodPressureDiastolic: " 80 ", temperatureCelsius: "37.5", notes: "  calm " })
    );
    expect(result).toEqual({
      ok: true,
      body: { bloodPressureSystolic: 120, bloodPressureDiastolic: 80, temperatureCelsius: 37.5, notes: "calm" },
    });
  });

  it("accepts a note on its own", () => {
    expect(validateVitalsForm(form({ notes: "Refused BP measurement" }))).toEqual({
      ok: true,
      body: { notes: "Refused BP measurement" },
    });
  });

  it("refuses an entirely empty set", () => {
    const result = validateVitalsForm(form({ notes: "   " }));
    expect(result).toEqual({ ok: false, errors: { form: "Enter at least one measurement or a note." } });
  });

  it("limits notes to 2000 characters after trimming", () => {
    expect(validateVitalsForm(form({ notes: ` ${"n".repeat(2000)} ` })).ok).toBe(true);
    expect(validateVitalsForm(form({ notes: "n".repeat(2001) })).ok).toBe(false);
  });
});

describe("parseNumericString", () => {
  it("converts NUMERIC strings from the API to numbers", () => {
    expect(parseNumericString("37.5")).toBe(37.5);
    expect(parseNumericString("70.25")).toBe(70.25);
    expect(parseNumericString("170.0")).toBe(170);
  });

  it("gives null — never NaN — for null, blank or unparseable input", () => {
    expect(parseNumericString(null)).toBeNull();
    expect(parseNumericString(undefined)).toBeNull();
    expect(parseNumericString("")).toBeNull();
    expect(parseNumericString("  ")).toBeNull();
    expect(parseNumericString("n/a")).toBeNull();
  });
});

describe("toVitalSigns", () => {
  const row: VitalSignsResponse = {
    id: "v1",
    visitId: "visit",
    recordedBy: "nurse",
    bloodPressureSystolic: 120,
    bloodPressureDiastolic: 80,
    pulseBpm: 72,
    temperatureCelsius: "37.5",
    weightKg: "70.25",
    heightCm: null,
    respiratoryRate: 16,
    oxygenSaturationPct: 98,
    notes: null,
    recordedAt: "2026-09-28T08:00:00.000Z",
  };

  it("converts only the three string columns and leaves the rest untouched", () => {
    expect(toVitalSigns(row)).toEqual({ ...row, temperatureCelsius: 37.5, weightKg: 70.25, heightCm: null });
  });

  it("makes arithmetic safe: 37.5 + 1 is 38.5, not '37.51'", () => {
    const vitals = toVitalSigns(row);
    expect((vitals.temperatureCelsius ?? 0) + 1).toBe(38.5);
  });
});

describe("display formatting", () => {
  it("formats blood pressure, including a missing side", () => {
    expect(formatBloodPressure(120, 80)).toBe("120/80");
    expect(formatBloodPressure(120, null)).toBe("120/–");
    expect(formatBloodPressure(null, null)).toBeNull();
  });

  it("formats measurements with fixed decimals", () => {
    expect(formatMeasurement(37.5, 1, "°C")).toBe("37.5 °C");
    expect(formatMeasurement(70, 2, "kg")).toBe("70.00 kg");
    expect(formatMeasurement(null, 1, "cm")).toBeNull();
  });
});
