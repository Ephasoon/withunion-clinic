import { navItemsFor, type FeatureRoute } from "./routes";

type NavItem = FeatureRoute & { label: string };

/**
 * The sidebar's groups, in display order, each listing route paths in
 * display order. This only arranges navigation — who may see a link is
 * still decided by navItemsFor() (each route's `roles`), unchanged.
 * Every labelled route must appear in exactly one group (navigation.test.ts
 * checks this, so a new nav route can't silently go missing).
 */
export const NAV_GROUPS: readonly { label: string; paths: readonly string[] }[] = [
  { label: "Main", paths: ["dashboard", "visits/today", "patients"] },
  { label: "Clinical", paths: ["nursing/queue", "doctor/queue", "laboratory/queue", "pharmacy/queue"] },
  { label: "Operations", paths: ["inventory", "billing", "price-list", "suppliers", "purchases"] },
  { label: "Management", paths: ["reports", "users", "audit-log"] },
];

export interface SidebarSection {
  /** null when the user sees only one item of the group — the link is shown without a header. */
  label: string | null;
  items: readonly NavItem[];
}

/**
 * The user's nav items arranged into sidebar sections. Groups with no
 * visible item are left out; a group with exactly one visible item keeps
 * the link but drops its header (a nurse sees just "Nurse queue").
 */
export function sidebarSectionsFor(user: { role: string } | null): SidebarSection[] {
  const visible = new Map(navItemsFor(user).map((item) => [item.path, item]));
  return NAV_GROUPS.flatMap((group) => {
    const items = group.paths.flatMap((path) => visible.get(path) ?? []);
    if (items.length === 0) return [];
    return [{ label: items.length >= 2 ? group.label : null, items }];
  });
}

/**
 * Whether a nav item is the current page: its own path, or any page under
 * it (e.g. Patients stays highlighted on /patients/123, Billing on an
 * invoice) — the same rule as react-router's NavLink without `end`.
 */
export function isNavItemActive(pathname: string, itemPath: string): boolean {
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const target = `/${itemPath}`;
  return current === target || current.startsWith(`${target}/`);
}
