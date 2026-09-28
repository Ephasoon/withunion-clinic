import { describe, expect, it } from "vitest";
import { patientAgeText } from "../features/patients/patientDisplay";
import { ageFromIsoDate, formatIsoDate, isValidIsoDate, todayIsoDate } from "./dates";

describe("isValidIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isValidIsoDate("1990-05-14")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("1900-02-29")).toBe(false);
    expect(isValidIsoDate("2023-02-29")).toBe(false);
    expect(isValidIsoDate("1990-04-31")).toBe(false);
    expect(isValidIsoDate("1990-5-14")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("formatIsoDate", () => {
  it("formats without any timezone conversion", () => {
    expect(formatIsoDate("1990-05-14")).toBe("14 May 1990");
    expect(formatIsoDate("2000-01-01")).toBe("1 Jan 2000");
    expect(formatIsoDate("1999-12-31")).toBe("31 Dec 1999");
  });

  it("returns unparseable input unchanged", () => {
    expect(formatIsoDate("not a date")).toBe("not a date");
  });
});

describe("ageFromIsoDate", () => {
  it("counts whole years, turning over on the birthday", () => {
    expect(ageFromIsoDate("1990-05-14", "2026-05-13")).toBe(35);
    expect(ageFromIsoDate("1990-05-14", "2026-05-14")).toBe(36);
    expect(ageFromIsoDate("1990-05-14", "2026-09-28")).toBe(36);
  });

  it("is 0 for a baby and null for a future or invalid date", () => {
    expect(ageFromIsoDate("2026-09-01", "2026-09-28")).toBe(0);
    expect(ageFromIsoDate("2026-10-01", "2026-09-28")).toBeNull();
    expect(ageFromIsoDate("bad", "2026-09-28")).toBeNull();
  });
});

describe("todayIsoDate", () => {
  it("uses the device's local calendar day", () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("patientAgeText", () => {
  it("prefers date of birth, then approximate age", () => {
    expect(patientAgeText({ dateOfBirth: "1990-05-14", approximateAge: 30 }, "2026-09-28")).toBe(
      "36 yrs (born 14 May 1990)"
    );
    expect(patientAgeText({ dateOfBirth: null, approximateAge: 30 }, "2026-09-28")).toBe("~30 yrs (approx.)");
    expect(patientAgeText({ dateOfBirth: null, approximateAge: null }, "2026-09-28")).toBe("Age not recorded");
  });
});
