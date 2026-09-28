import { describe, expect, it } from "vitest";
import {
  EMPTY_PRESCRIPTION_ROW,
  validateDiagnosis,
  validateLabOrder,
  validateNotes,
  validatePrescription,
  type PrescriptionRow,
} from "./consultationForms";

const row = (overrides: Partial<PrescriptionRow>): PrescriptionRow => ({ ...EMPTY_PRESCRIPTION_ROW, ...overrides });

describe("validateNotes (≤8000 after trim, empty allowed)", () => {
  it("allows empty notes and trims", () => {
    expect(validateNotes("   ")).toEqual({ ok: true, value: "" });
    expect(validateNotes("  Fever ")).toEqual({ ok: true, value: "Fever" });
  });

  it("enforces 8000 characters", () => {
    expect(validateNotes("n".repeat(8000)).ok).toBe(true);
    expect(validateNotes("n".repeat(8001)).ok).toBe(false);
  });
});

describe("validateDiagnosis (1–2000 after trim)", () => {
  it("requires text and trims", () => {
    expect(validateDiagnosis("  ").ok).toBe(false);
    expect(validateDiagnosis(" Malaria ")).toEqual({ ok: true, value: "Malaria" });
  });

  it("enforces 2000 characters", () => {
    expect(validateDiagnosis("d".repeat(2000)).ok).toBe(true);
    expect(validateDiagnosis("d".repeat(2001)).ok).toBe(false);
  });
});

describe("validateLabOrder (1–50 tests, each 1–255)", () => {
  it("takes one test per line, trimming and dropping blank lines", () => {
    expect(validateLabOrder(" CBC \n\n  Malaria RDT\r\n ")).toEqual({ ok: true, value: ["CBC", "Malaria RDT"] });
  });

  it("requires at least one test", () => {
    expect(validateLabOrder("\n  \n").ok).toBe(false);
  });

  it("allows 50 tests and refuses 51", () => {
    const tests = (n: number) => Array.from({ length: n }, (_, i) => `Test ${i}`).join("\n");
    expect(validateLabOrder(tests(50)).ok).toBe(true);
    expect(validateLabOrder(tests(51)).ok).toBe(false);
  });

  it("limits each test name to 255 characters", () => {
    expect(validateLabOrder("t".repeat(255)).ok).toBe(true);
    expect(validateLabOrder("t".repeat(256)).ok).toBe(false);
  });
});

describe("validatePrescription", () => {
  it("builds items, omitting blank optional fields and parsing quantity", () => {
    expect(
      validatePrescription([
        row({ medicineName: " Amoxicillin ", strength: "500mg", frequency: "TDS", quantity: "15" }),
        row({ medicineName: "Paracetamol" }),
      ])
    ).toEqual({
      ok: true,
      items: [
        { medicineName: "Amoxicillin", strength: "500mg", frequency: "TDS", quantityPrescribed: 15 },
        { medicineName: "Paracetamol" },
      ],
    });
  });

  it("ignores rows left entirely blank", () => {
    expect(validatePrescription([row({ medicineName: "ORS" }), EMPTY_PRESCRIPTION_ROW])).toEqual({
      ok: true,
      items: [{ medicineName: "ORS" }],
    });
  });

  it("requires at least one medicine", () => {
    const result = validatePrescription([EMPTY_PRESCRIPTION_ROW]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Add at least one medicine.");
  });

  it("requires a medicine name on a partly filled row", () => {
    const result = validatePrescription([row({ dosage: "1 tab" })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rowErrors[0]?.medicineName).toBe("Enter the medicine.");
  });

  it("enforces the text limits: medicine 255, others 100", () => {
    expect(validatePrescription([row({ medicineName: "m".repeat(255), dosage: "d".repeat(100) })]).ok).toBe(true);
    const result = validatePrescription([row({ medicineName: "m".repeat(256), duration: "d".repeat(101) })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.rowErrors[0]!).sort()).toEqual(["duration", "medicineName"]);
  });

  it("accepts quantity 1–100000 as a whole number only", () => {
    expect(validatePrescription([row({ medicineName: "A", quantity: "1" })]).ok).toBe(true);
    expect(validatePrescription([row({ medicineName: "A", quantity: "100000" })]).ok).toBe(true);
    for (const bad of ["0", "100001", "2.5", "-3", "ten"]) {
      expect(validatePrescription([row({ medicineName: "A", quantity: bad })]).ok, bad).toBe(false);
    }
  });

  it("allows 50 medicines and refuses 51", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => row({ medicineName: `Med ${i}` }));
    expect(validatePrescription(rows(50)).ok).toBe(true);
    const result = validatePrescription(rows(51));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most 50/);
  });
});
