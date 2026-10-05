import { describe, expect, it } from "vitest";
import {
  patientSearchEmptyText,
  patientSearchHelperText,
  patientSearchParams,
  readPatientSearchParams,
} from "./patientSearchState";
import { patientKeys } from "./queries";

describe("readPatientSearchParams", () => {
  it("defaults to no term and the box unticked", () => {
    expect(readPatientSearchParams(new URLSearchParams(""))).toEqual({ term: "", includeInactive: false });
  });

  it("reads the term and ?inactive=1", () => {
    expect(readPatientSearchParams(new URLSearchParams("q=amina&inactive=1"))).toEqual({
      term: "amina",
      includeInactive: true,
    });
  });

  it("only inactive=1 ticks the box", () => {
    for (const value of ["0", "true", "yes", ""]) {
      expect(readPatientSearchParams(new URLSearchParams({ inactive: value })).includeInactive, value).toBe(false);
    }
  });
});

describe("patientSearchParams", () => {
  it("leaves defaults out of the URL", () => {
    expect(patientSearchParams({ term: "", includeInactive: false })).toEqual({});
    expect(patientSearchParams({ term: "amina", includeInactive: false })).toEqual({ q: "amina" });
  });

  it("writes ?inactive=1 only when ticked, alongside the term", () => {
    expect(patientSearchParams({ term: "", includeInactive: true })).toEqual({ inactive: "1" });
    expect(patientSearchParams({ term: "0911", includeInactive: true })).toEqual({ q: "0911", inactive: "1" });
  });

  it("round-trips through the URL", () => {
    for (const state of [
      { term: "", includeInactive: false },
      { term: "Desta Ledamo", includeInactive: true },
      { term: "0911 22", includeInactive: false },
    ]) {
      expect(readPatientSearchParams(new URLSearchParams(patientSearchParams(state)))).toEqual(state);
    }
  });
});

describe("patientSearchEmptyText", () => {
  it("default view: no active patients match", () => {
    expect(patientSearchEmptyText(" amina ", false)).toBe("No active patients match “amina”.");
  });

  it("box ticked: no patients match", () => {
    expect(patientSearchEmptyText(" amina ", true)).toBe("No patients match “amina”.");
  });

  it("no search term: nothing registered yet, either way", () => {
    expect(patientSearchEmptyText("  ", false)).toBe("No patients have been registered yet.");
    expect(patientSearchEmptyText("", true)).toBe("No patients have been registered yet.");
  });
});

describe("patientSearchHelperText", () => {
  it("default view: only active patients", () => {
    expect(patientSearchHelperText(false, true)).toBe("Only active patients are listed.");
    expect(patientSearchHelperText(false, false)).toBe(
      "Only active patients are listed. With no search, the newest registrations are shown."
    );
  });

  it("box ticked: active and inactive patients", () => {
    expect(patientSearchHelperText(true, true)).toBe("Active and inactive patients are listed.");
    expect(patientSearchHelperText(true, false)).toBe(
      "Active and inactive patients are listed. With no search, the newest registrations are shown."
    );
  });
});

describe("patientKeys.search", () => {
  it("keeps ticked and unticked results apart, under the shared search prefix", () => {
    expect(patientKeys.search("a", 20, true)).not.toEqual(patientKeys.search("a", 20, false));
    expect(patientKeys.search("a", 20, true).slice(0, 2)).toEqual([...patientKeys.searches]);
  });
});
