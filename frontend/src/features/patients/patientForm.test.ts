import { describe, expect, it } from "vitest";
import {
  AGE_NOT_REMOVABLE,
  buildPatientPatch,
  DOB_NOT_REMOVABLE,
  EMPTY_PATIENT_FORM,
  NO_CHANGES_MESSAGE,
  patientFormValues,
  serverFieldErrors,
  validatePatientForm,
  type PatientFormValues,
} from "./patientForm";
import type { Patient } from "./types";

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

const PATIENT: Patient = {
  id: "p1",
  patientCode: "WU-000123",
  fullName: "Amina Tesfaye",
  gender: "female",
  dateOfBirth: "1990-05-14",
  approximateAge: null,
  phone: "0911223344",
  address: "Hawassa",
  emergencyContactName: null,
  emergencyContactPhone: null,
  status: "active",
  notes: null,
  createdBy: "u1",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

const draft = (overrides: Partial<PatientFormValues & { status: Patient["status"] }> = {}, patient = PATIENT) => ({
  ...patientFormValues(patient),
  status: patient.status,
  ...overrides,
});

describe("patientFormValues", () => {
  it("turns nulls into empty strings and the age into text, keeping dateOfBirth as is", () => {
    expect(patientFormValues({ ...PATIENT, approximateAge: 34 })).toEqual({
      fullName: "Amina Tesfaye",
      gender: "female",
      dateOfBirth: "1990-05-14",
      approximateAge: "34",
      phone: "0911223344",
      address: "Hawassa",
      emergencyContactName: "",
      emergencyContactPhone: "",
      notes: "",
    });
  });
});

describe("buildPatientPatch — only changed fields", () => {
  it("unchanged form → the same 'nothing changed' kind of message as Suppliers and Price List", () => {
    expect(buildPatientPatch(PATIENT, draft(), TODAY)).toEqual({ ok: false, errors: {}, message: NO_CHANGES_MESSAGE });
  });

  it("whitespace-only differences are not changes (compared after trimming)", () => {
    expect(buildPatientPatch(PATIENT, draft({ fullName: " Amina Tesfaye ", phone: "0911223344 " }), TODAY)).toMatchObject({
      ok: false,
      message: NO_CHANGES_MESSAGE,
    });
  });

  it("sends just the fields that changed, trimmed", () => {
    expect(buildPatientPatch(PATIENT, draft({ phone: " 0922000000 " }), TODAY)).toEqual({
      ok: true,
      body: { phone: "0922000000" },
    });
    expect(buildPatientPatch(PATIENT, draft({ gender: "other", notes: "Allergic to penicillin" }), TODAY)).toEqual({
      ok: true,
      body: { gender: "other", notes: "Allergic to penicillin" },
    });
  });

  it("a re-formatted phone is sent as typed (the backend does not treat it as a new number)", () => {
    expect(buildPatientPatch(PATIENT, draft({ phone: "+251 911 223 344" }), TODAY)).toEqual({
      ok: true,
      body: { phone: "+251 911 223 344" },
    });
  });

  it('clearing a text field sends "" (never null), and clearing the phone is allowed', () => {
    expect(buildPatientPatch(PATIENT, draft({ phone: "", address: "  " }), TODAY)).toEqual({
      ok: true,
      body: { phone: "", address: "" },
    });
  });

  it("status changes are sent, alone or with other fields", () => {
    expect(buildPatientPatch(PATIENT, draft({ status: "inactive" }), TODAY)).toEqual({
      ok: true,
      body: { status: "inactive" },
    });
    const inactive = { ...PATIENT, status: "inactive" as const };
    expect(buildPatientPatch(inactive, draft({ status: "active", address: "Shashemene" }, inactive), TODAY)).toEqual({
      ok: true,
      body: { address: "Shashemene", status: "active" },
    });
  });

  it("dateOfBirth stays the plain YYYY-MM-DD string", () => {
    const result = buildPatientPatch(PATIENT, draft({ dateOfBirth: "2000-01-01" }), TODAY);
    expect(result).toEqual({ ok: true, body: { dateOfBirth: "2000-01-01" } });
    expect(result.ok && typeof result.body.dateOfBirth).toBe("string");
  });

  it("the age is compared and sent as a number", () => {
    const withAge = { ...PATIENT, approximateAge: 34 };
    expect(buildPatientPatch(withAge, draft({ approximateAge: " 34 " }, withAge), TODAY)).toMatchObject({ ok: false });
    expect(buildPatientPatch(withAge, draft({ approximateAge: "35" }, withAge), TODAY)).toEqual({
      ok: true,
      body: { approximateAge: 35 },
    });
  });

  it("adding an age to a patient who only had a date of birth is allowed", () => {
    expect(buildPatientPatch(PATIENT, draft({ approximateAge: "36" }), TODAY)).toEqual({
      ok: true,
      body: { approximateAge: 36 },
    });
  });
});

describe("buildPatientPatch — validation", () => {
  it("reuses the registration rules", () => {
    const result = buildPatientPatch(
      PATIENT,
      draft({ fullName: " ", dateOfBirth: "2026-09-29", phone: "1".repeat(33) }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.fullName).toBe("Enter the patient's full name.");
      expect(result.errors.dateOfBirth).toBe("Date of birth cannot be in the future.");
      expect(result.errors.phone).toBeDefined();
    }
  });

  it("a recorded date of birth can't be removed (it can't be set to null)", () => {
    const result = buildPatientPatch(PATIENT, draft({ dateOfBirth: "", approximateAge: "36" }), TODAY);
    expect(result).toEqual({ ok: false, errors: { dateOfBirth: DOB_NOT_REMOVABLE } });
  });

  it("a recorded approximate age can't be removed either", () => {
    const withAge = { ...PATIENT, dateOfBirth: null, approximateAge: 34 };
    const result = buildPatientPatch(withAge, draft({ approximateAge: "", dateOfBirth: "1992-01-01" }, withAge), TODAY);
    expect(result).toEqual({ ok: false, errors: { approximateAge: AGE_NOT_REMOVABLE } });
  });

  it("clearing both reports the registration rule on dateOfBirth", () => {
    const result = buildPatientPatch(PATIENT, draft({ dateOfBirth: "" }), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dateOfBirth).toBe("Enter a date of birth or an approximate age.");
  });

  it("only ever contains keys the strict backend schema accepts, and never null", () => {
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
      "status",
    ];
    const result = buildPatientPatch(
      PATIENT,
      {
        fullName: "A",
        gender: "male",
        dateOfBirth: "1991-01-01",
        approximateAge: "3",
        phone: "1",
        address: "a",
        emergencyContactName: "b",
        emergencyContactPhone: "2",
        notes: "c",
        status: "inactive",
      },
      TODAY
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.body).sort()).toEqual([...allowed].sort());
      for (const value of Object.values(result.body)) expect(value).not.toBeNull();
    }
  });
});
