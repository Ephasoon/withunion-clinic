import { describe, expect, it } from "vitest";
import { featureRoutes, navItemsFor } from "./routes";

const rolesFor = (path: string) => featureRoutes.find((r) => r.path === path)?.roles;

describe("featureRoutes — Reception + Visits", () => {
  it("guards each screen with the roles the backend allows", () => {
    expect(rolesFor("patients")).toEqual(["reception", "owner"]);
    expect(rolesFor("patients/new")).toEqual(["reception"]);
    expect(rolesFor("patients/:patientId")).toEqual(["reception", "owner"]);
    expect(rolesFor("visits/today")).toEqual(["reception", "owner"]);
    expect(rolesFor("visits/:visitId")).toEqual(["reception", "owner"]);
  });

  it("has no duplicate paths", () => {
    const paths = featureRoutes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("navItemsFor", () => {
  it("lists the queue and patients for reception and owner, never detail or form pages", () => {
    expect(navItemsFor({ role: "reception" }).map((r) => r.path)).toEqual(["visits/today", "patients"]);
    expect(navItemsFor({ role: "owner" }).map((r) => r.path)).toEqual(["visits/today", "patients"]);
  });

  it("lists nothing for clinical roles or when signed out", () => {
    for (const role of ["nurse", "doctor", "lab_tech", "pharmacy"]) expect(navItemsFor({ role })).toEqual([]);
    expect(navItemsFor(null)).toEqual([]);
  });
});
