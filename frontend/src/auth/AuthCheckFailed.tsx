import { useRetryAuthCheck } from "./useAuth";

/** The startup /auth/me check could not get an answer (server unreachable or erroring). */
export function AuthCheckFailed() {
  const retry = useRetryAuthCheck();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Cannot reach the clinic server</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your session could not be checked. The server may be down or restarting.
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
