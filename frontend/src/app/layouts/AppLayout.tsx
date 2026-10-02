import { Outlet, useLocation } from "react-router";
import { useAuth, useLogout } from "../../auth/useAuth";
import { sidebarSectionsFor } from "../navigation";
import { Sidebar } from "./Sidebar";

/** Shell for every signed-in page: the left sidebar (navigation, the signed-in user, sign-out) and the page. */
export function AppLayout() {
  const auth = useAuth();
  const logoutMutation = useLogout();
  const { pathname } = useLocation();
  const user = auth.status === "authenticated" ? auth.user : null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:flex-row">
      <Sidebar
        sections={sidebarSectionsFor(user)}
        pathname={pathname}
        user={user}
        onSignOut={() => logoutMutation.mutate()}
        signingOut={logoutMutation.isPending}
      />

      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
