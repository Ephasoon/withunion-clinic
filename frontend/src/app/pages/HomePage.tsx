import { useAuth } from "../../auth/useAuth";
import { roleLabel } from "../../rbac/roles";

/** Minimal signed-in landing page; exists only so the authenticated route has something to render. */
export function HomePage() {
  const auth = useAuth();
  if (auth.status !== "authenticated") return null;

  return (
    <section>
      <h1 className="text-xl font-semibold text-slate-900">Welcome, {auth.user.fullName}</h1>
      <p className="mt-1 text-sm text-slate-600">Signed in as {roleLabel(auth.user.role)}.</p>
    </section>
  );
}
