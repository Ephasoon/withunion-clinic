import { Link } from "react-router";
import { roleLabel } from "../../rbac/roles";
import { isNavItemActive, type SidebarSection } from "../navigation";

/**
 * The always-expanded left sidebar: clinic name, the user's navigation in
 * groups, and the signed-in user with sign-out at the bottom. Takes
 * everything as props (no auth or router hooks) so it renders the same in
 * tests as in the app.
 */
export function Sidebar({
  sections,
  pathname,
  user,
  onSignOut,
  signingOut,
}: {
  sections: readonly SidebarSection[];
  pathname: string;
  user: { fullName: string; role: string } | null;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  return (
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
      <div className="px-5 py-4">
        <Link to="/" className="text-base font-semibold text-slate-900">
          WithUnion Clinic
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {sections.map((section, index) => {
          const headingId = section.label ? `nav-group-${index}` : undefined;
          return (
            <div key={section.label ?? section.items[0]!.path}>
              {section.label && (
                <p id={headingId} className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {section.label}
                </p>
              )}
              <ul aria-labelledby={headingId} className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isNavItemActive(pathname, item.path);
                  return (
                    <li key={item.path}>
                      <Link
                        to={`/${item.path}`}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-md px-3 py-1.5 text-sm font-medium ${
                          active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {user && (
        <div className="border-t border-slate-200 px-5 py-4">
          <p className="text-xs text-slate-500">Signed in as</p>
          <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
          <p className="text-xs text-slate-500">{roleLabel(user.role)}</p>
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="mt-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </aside>
  );
}
