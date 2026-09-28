import { NavLink, Outlet } from "react-router";
import { useAuth, useLogout } from "../../auth/useAuth";
import { roleLabel } from "../../rbac/roles";
import { navItemsFor } from "../routes";

/** Shell for every signed-in page: top bar with navigation, the signed-in user, and sign-out. */
export function AppLayout() {
  const auth = useAuth();
  const logoutMutation = useLogout();
  const user = auth.status === "authenticated" ? auth.user : null;
  const navItems = navItemsFor(user);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <NavLink to="/" className="text-base font-semibold text-slate-900">
            WithUnion Clinic
          </NavLink>

          <nav aria-label="Main" className="flex flex-1 flex-wrap gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={`/${item.path}`}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
                <p className="text-xs text-slate-500">{roleLabel(user.role)}</p>
              </div>
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {logoutMutation.isPending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
