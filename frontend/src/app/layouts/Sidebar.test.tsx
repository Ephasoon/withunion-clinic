import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { sidebarSectionsFor } from "../navigation";
import { Sidebar } from "./Sidebar";

/** Renders the real Sidebar for a role at a path and returns its HTML. */
function render(role: string, pathname: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <Sidebar
        sections={sidebarSectionsFor({ role })}
        pathname={pathname}
        user={{ fullName: "Test User", role }}
        onSignOut={() => {}}
        signingOut={false}
      />
    </MemoryRouter>
  );
}

const headers = (html: string) => [...html.matchAll(/<p id="nav-group-\d+"[^>]*>([^<]+)<\/p>/g)].map((m) => m[1]);
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
const activeLinks = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);

describe("Sidebar (rendered)", () => {
  it("owner: clinic name, four group headers in order, every link to its page", () => {
    const html = render("owner", "/dashboard");
    expect(links(html)[0]).toEqual(["/", "WithUnion Clinic"]);
    expect(headers(html)).toEqual(["Main", "Clinical", "Operations", "Management"]);
    expect(links(html).slice(1)).toEqual([
      ["/dashboard", "Dashboard"],
      ["/visits/today", "Today’s queue"],
      ["/patients", "Patients"],
      ["/nursing/queue", "Nurse queue"],
      ["/doctor/queue", "Doctor queue"],
      ["/inventory", "Inventory"],
      ["/price-list", "Price List"],
      ["/suppliers", "Suppliers"],
      ["/purchases", "Purchases"],
      ["/reports", "Reports"],
      ["/users", "Users"],
      ["/audit-log", "Audit log"],
    ]);
  });

  it("nurse: just Nurse queue, with no group header", () => {
    const html = render("nurse", "/nursing/queue");
    expect(headers(html)).toEqual([]);
    expect(html).not.toMatch(/Clinical/);
    expect(links(html).slice(1)).toEqual([["/nursing/queue", "Nurse queue"]]);
  });

  it("reception: the Main header but no Operations header over the lone Billing link", () => {
    const html = render("reception", "/billing");
    expect(headers(html)).toEqual(["Main"]);
    expect(html).not.toMatch(/Operations/);
    expect(links(html).slice(1).map(([href]) => href)).toEqual(["/visits/today", "/patients", "/billing"]);
  });

  it("highlights only the current page, including on pages beneath it", () => {
    expect(activeLinks(render("owner", "/dashboard"))).toEqual(["Dashboard"]);
    expect(activeLinks(render("owner", "/patients/123"))).toEqual(["Patients"]);
    expect(activeLinks(render("reception", "/billing/visits/v1"))).toEqual(["Billing"]);
    expect(activeLinks(render("owner", "/reports/financial"))).toEqual(["Reports"]);
    expect(activeLinks(render("owner", "/"))).toEqual([]);
  });

  it("the active link gets the highlighted style, the others don't", () => {
    const html = render("owner", "/suppliers");
    const anchor = (label: string) => html.match(new RegExp(`<a [^>]*>${label}</a>`))![0];
    expect(anchor("Suppliers")).toMatch(/bg-slate-900 text-white/);
    expect(anchor("Purchases")).not.toMatch(/bg-slate-900/);
  });

  it("shows who is signed in, their role, and Sign out", () => {
    const html = render("lab_tech", "/laboratory/queue");
    expect(html).toMatch(/Signed in as/);
    expect(html).toMatch(/Test User/);
    expect(html).toMatch(/Lab/);
    expect(html).toMatch(/>Sign out</);
  });
});
