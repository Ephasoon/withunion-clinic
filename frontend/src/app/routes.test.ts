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
    expect(rolesFor("doctor/queue")).toEqual(["doctor", "owner"]);
    expect(rolesFor("doctor/visits/:visitId")).toEqual(["doctor", "owner"]);
    expect(rolesFor("doctor/consultations/:consultationId")).toEqual(["doctor", "owner"]);
    // GET /laboratory/orders is lab_tech-only on the backend, so the owner does not get the queue.
    expect(rolesFor("laboratory/queue")).toEqual(["lab_tech"]);
    expect(rolesFor("laboratory/orders/:orderId")).toEqual(["lab_tech", "owner"]);
    // GET /pharmacy/prescriptions is pharmacy-only on the backend, so the owner does not get the queue.
    expect(rolesFor("pharmacy/queue")).toEqual(["pharmacy"]);
    expect(rolesFor("pharmacy/prescriptions/:prescriptionId")).toEqual(["pharmacy", "owner"]);
    expect(rolesFor("inventory")).toEqual(["pharmacy", "owner"]);
    // GET /billing/invoices is reception-only on the backend, so the owner does not get the work queue.
    expect(rolesFor("billing")).toEqual(["reception"]);
    expect(rolesFor("billing/visits/:visitId")).toEqual(["reception", "owner"]);
    for (const path of [
      "dashboard",
      "reports",
      "reports/visits",
      "reports/financial",
      "reports/purchasing",
      "reports/pharmacy-dispensing",
      "users",
      "users/new",
      "users/:userId",
    ]) {
      expect(rolesFor(path), path).toEqual(["owner"]);
    }
  });

  it("has no duplicate paths", () => {
    const paths = featureRoutes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("navItemsFor", () => {
  it("lists each role's screens, never detail or form pages", () => {
    expect(navItemsFor({ role: "reception" }).map((r) => r.path)).toEqual(["visits/today", "patients", "billing"]);
    expect(navItemsFor({ role: "nurse" }).map((r) => r.path)).toEqual(["nursing/queue"]);
    expect(navItemsFor({ role: "doctor" }).map((r) => r.path)).toEqual(["doctor/queue"]);
    expect(navItemsFor({ role: "lab_tech" }).map((r) => r.path)).toEqual(["laboratory/queue"]);
    expect(navItemsFor({ role: "pharmacy" }).map((r) => r.path)).toEqual(["pharmacy/queue", "inventory"]);
    expect(navItemsFor({ role: "owner" }).map((r) => r.path)).toEqual([
      "visits/today",
      "patients",
      "nursing/queue",
      "doctor/queue",
      "inventory",
      "dashboard",
      "reports",
      "users",
    ]);
  });

  it("lists nothing for unknown roles or when signed out", () => {
    expect(navItemsFor({ role: "admin" })).toEqual([]);
    expect(navItemsFor(null)).toEqual([]);
  });
});
