import { Outlet } from "react-router";

/** Centered card for the signed-out pages. */
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <p className="mb-6 text-sm font-semibold uppercase tracking-wide text-slate-500">WithUnion Clinic</p>
      <main className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <Outlet />
      </main>
    </div>
  );
}
