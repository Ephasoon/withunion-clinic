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
    expect(rolesFor("nursing/queue")).toEqual(["nurse", "owner"]);
    expect(rolesFor("nursing/visits/:visitId")).toEqual(["nurse", "owner"]);
  });

  it("has no duplicate paths", () => {
    const paths = featureRoutes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("navItemsFor", () => {
  it("lists each role's screens, never detail or form pages", () => {
    expect(navItemsFor({ role: "reception" }).map((r) => r.path)).toEqual(["visits/today", "patients"]);
    expect(navItemsFor({ role: "nurse" }).map((r) => r.path)).toEqual(["nursing/queue"]);
    expect(navItemsFor({ role: "owner" }).map((r) => r.path)).toEqual(["visits/today", "patients", "nursing/queue"]);
  });

  it("lists nothing for roles without screens yet, or when signed out", () => {
    for (const role of ["doctor", "lab_tech", "pharmacy"]) expect(navItemsFor({ role })).toEqual([]);
    expect(navItemsFor(null)).toEqual([]);
  });
});
