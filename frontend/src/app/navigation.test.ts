import { describe, expect, it } from "vitest";
import { ALL_ROLES } from "../rbac/roles";
import { isNavItemActive, NAV_GROUPS, sidebarSectionsFor } from "./navigation";
import { featureRoutes, navItemsFor } from "./routes";

/** Each section as [header or null, ...paths] — compact enough to compare per role. */
const layout = (role: string) => sidebarSectionsFor({ role }).map((s) => [s.label, ...s.items.map((i) => i.path)]);

describe("NAV_GROUPS", () => {
  it("places every nav route in exactly one group, and lists nothing else", () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.paths);
    const navPaths = featureRoutes.filter((r) => r.label !== undefined).map((r) => r.path);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...navPaths].sort());
  });
});

describe("sidebarSectionsFor — groups per role", () => {
  it("owner: all four groups, each with a header", () => {
    expect(layout("owner")).toEqual([
      ["Main", "dashboard", "visits/today", "patients"],
      ["Clinical", "nursing/queue", "doctor/queue"],
      ["Operations", "inventory", "price-list", "suppliers", "purchases"],
      ["Management", "reports", "users", "audit-log"],
    ]);
  });

  it("reception: Main with a header; Billing alone, without one", () => {
    expect(layout("reception")).toEqual([
      ["Main", "visits/today", "patients"],
      [null, "billing"],
    ]);
  });

  it("single-queue roles: one link, no group header", () => {
    expect(layout("nurse")).toEqual([[null, "nursing/queue"]]);
    expect(layout("doctor")).toEqual([[null, "doctor/queue"]]);
    expect(layout("lab_tech")).toEqual([[null, "laboratory/queue"]]);
  });

  it("pharmacy: one item in Clinical and one in Operations — both without headers", () => {
    expect(layout("pharmacy")).toEqual([
      [null, "pharmacy/queue"],
      [null, "inventory"],
    ]);
  });

  it("a header appears exactly when the group has 2 or more visible items", () => {
    for (const role of ALL_ROLES) {
      for (const section of sidebarSectionsFor({ role })) {
        expect(section.label !== null, `${role}: ${section.items.map((i) => i.path)}`).toBe(section.items.length >= 2);
      }
    }
  });

  it("shows exactly the links navItemsFor allows — visibility is unchanged, only arranged", () => {
    for (const role of ALL_ROLES) {
      const shown = sidebarSectionsFor({ role }).flatMap((s) => s.items.map((i) => i.path));
      expect([...shown].sort(), role).toEqual(navItemsFor({ role }).map((i) => i.path).sort());
    }
  });

  it("nothing for unknown roles or when signed out", () => {
    expect(sidebarSectionsFor({ role: "admin" })).toEqual([]);
    expect(sidebarSectionsFor(null)).toEqual([]);
  });
});

describe("isNavItemActive", () => {
  it("matches the item's own page and pages beneath it", () => {
    expect(isNavItemActive("/patients", "patients")).toBe(true);
    expect(isNavItemActive("/patients/", "patients")).toBe(true);
    expect(isNavItemActive("/patients/abc", "patients")).toBe(true);
    expect(isNavItemActive("/billing/visits/v1", "billing")).toBe(true);
    expect(isNavItemActive("/reports/financial", "reports")).toBe(true);
    expect(isNavItemActive("/visits/today", "visits/today")).toBe(true);
  });

  it("does not match a different page that merely shares a prefix", () => {
    expect(isNavItemActive("/patients-archive", "patients")).toBe(false);
    expect(isNavItemActive("/visits/abc", "visits/today")).toBe(false);
    expect(isNavItemActive("/purchases", "price-list")).toBe(false);
    expect(isNavItemActive("/", "dashboard")).toBe(false);
  });
});
