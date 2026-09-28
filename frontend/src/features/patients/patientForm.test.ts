import { describe, expect, it } from "vitest";
import { EMPTY_PATIENT_FORM, serverFieldErrors, validatePatientForm, type PatientFormValues } from "./patientForm";

const TODAY = "2026-09-28";
const form = (overrides: Partial<PatientFormValues>): PatientFormValues => ({
  ...EMPTY_PATIENT_FORM,
  fullName: "Amina Tesfaye",
  gender: "female",
  ...overrides,
});

describe("validatePatientForm — date of birth or approximate age", () => {
  it("requires one of them, reporting the error on dateOfBirth like the backend", () => {
    const result = validatePatientForm(form({}), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.dateOfBirth).toBe("Enter a date of birth or an approximate age.");
      expect(result.errors.approximateAge).toBeUndefined();
    }
  });

  it("accepts date of birth alone", () => {
    expect(validatePatientForm(form({ dateOfBirth: "1990-05-14" }), TODAY)).toMatchObject({ ok: true });
  });

  it("accepts approximate age alone, including 0", () => {
    expect(validatePatientForm(form({ approximateAge: "34" }), TODAY)).toMatchObject({ ok: true });
    expect(validatePatientForm(form({ approximateAge: "0" }), TODAY)).toMatchObject({ ok: true });
  });

  it("accepts both", () => {
    expect(validatePatientForm(form({ dateOfBirth: "1990-05-14", approximateAge: "36" }), TODAY)).toMatchObject({
      ok: true,
    });
  });
});

describe("validatePatientForm — dateOfBirth stays a plain YYYY-MM-DD string", () => {
  it("sends the exact string, never a Date or a timestamp", () => {
    const result = validatePatientForm(form({ dateOfBirth: "1990-05-14" }), TODAY);
    expect(result.ok && result.body.dateOfBirth).toBe("1990-05-14");
    expect(result.ok && typeof result.body.dateOfBirth).toBe("string");
  });

  it("keeps a 1 January date exactly, with no timezone shift", () => {
    const result = validatePatientForm(form({ dateOfBirth: "2000-01-01" }), TODAY);
    expect(result.ok && result.body.dateOfBirth).toBe("2000-01-01");
  });

  it("rejects impossible calendar dates", () => {
    for (const bad of ["1990-02-30", "2023-02-29", "1990-13-01", "1990-04-31", "1990-00-10", "1990-05-00"]) {
      const result = validatePatientForm(form({ dateOfBirth: bad }), TODAY);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.errors.dateOfBirth).toBe("Enter a valid date of birth.");
    }
  });

  it("accepts 29 February in a leap year", () => {
    expect(validatePatientForm(form({ dateOfBirth: "2024-02-29" }), TODAY)).toMatchObject({ ok: true });
    expect(validatePatientForm(form({ dateOfBirth: "2000-02-29" }), TODAY)).toMatchObject({ ok: true });
  });

  it("rejects malformed strings", () => {
    for (const bad of ["14/05/1990", "1990-5-14", "19900514", "1990-05-14T00:00:00Z"]) {
      expect(validatePatientForm(form({ dateOfBirth: bad }), TODAY).ok, bad).toBe(false);
    }
  });

  it("rejects a future date but allows today", () => {
    const future = validatePatientForm(form({ dateOfBirth: "2026-09-29" }), TODAY);
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.errors.dateOfBirth).toBe("Date of birth cannot be in the future.");
    expect(validatePatientForm(form({ dateOfBirth: TODAY }), TODAY)).toMatchObject({ ok: true });
  });
});

describe("validatePatientForm — approximate age", () => {
  it("rejects non-integers and non-numbers", () => {
    for (const bad of ["34.5", "-1", "abc", "3e1", "1,000"]) {
      const result = validatePatientForm(form({ approximateAge: bad }), TODAY);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.errors.approximateAge).toBeDefined();
    }
  });

  it("enforces 0–150", () => {
    expect(validatePatientForm(form({ approximateAge: "150" }), TODAY)).toMatchObject({ ok: true });
    expect(validatePatientForm(form({ approximateAge: "151" }), TODAY)).toMatchObject({ ok: false });
  });

  it("sends the age as a number", () => {
    const result = validatePatientForm(form({ approximateAge: " 34 " }), TODAY);
    expect(result.ok && result.body.approximateAge).toBe(34);
  });
});

describe("validatePatientForm — required fields and lengths", () => {
  it("requires a non-blank name and a gender", () => {
    const result = validatePatientForm(
      { ...EMPTY_PATIENT_FORM, fullName: "   ", gender: "", approximateAge: "30" },
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.fullName).toBeDefined();
      expect(result.errors.gender).toBeDefined();
    }
  });

  it("enforces the backend's maximum lengths after trimming", () => {
    const result = validatePatientForm(
      form({ approximateAge: "30", fullName: "x".repeat(256), phone: "1".repeat(33), notes: "n".repeat(2001) }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["fullName", "notes", "phone"]);
    }
    expect(validatePatientForm(form({ approximateAge: "30", phone: ` ${"1".repeat(32)} ` }), TODAY)).toMatchObject({
      ok: true,
    });
  });
});

describe("validatePatientForm — request body", () => {
  it("trims values and omits empty optional fields", () => {
    const result = validatePatientForm(
      form({ fullName: "  Amina Tesfaye ", approximateAge: "30", phone: " 0911 ", address: "   " }),
      TODAY
    );
    expect(result).toEqual({
      ok: true,
      body: { fullName: "Amina Tesfaye", gender: "female", approximateAge: 30, phone: "0911" },
    });
  });

  it("only ever contains keys the strict backend schema accepts", () => {
    const allowed = [
      "fullName",
      "gender",
      "dateOfBirth",
      "approximateAge",
      "phone",
      "address",
      "emergencyContactName",
      "emergencyContactPhone",
      "notes",
    ];
    const result = validatePatientForm(
      form({
        dateOfBirth: "1990-05-14",
        approximateAge: "36",
        phone: "1",
        address: "a",
        emergencyContactName: "b",
        emergencyContactPhone: "2",
        notes: "c",
      }),
      TODAY
    );
    expect(result.ok).toBe(true);
    if (result.ok) for (const key of Object.keys(result.body)) expect(allowed).toContain(key);
  });
});

describe("serverFieldErrors", () => {
  it("maps backend VALIDATION_ERROR details onto form fields", () => {
    expect(
      serverFieldErrors({ dateOfBirth: ["Either dateOfBirth or approximateAge is required"], phone: ["Too long"] })
    ).toEqual({ dateOfBirth: "Either dateOfBirth or approximateAge is required", phone: "Too long" });
  });

  it("ignores unknown keys and empty details", () => {
    expect(serverFieldErrors({ somethingElse: ["x"] })).toEqual({});
    expect(serverFieldErrors(null)).toEqual({});
  });
});
