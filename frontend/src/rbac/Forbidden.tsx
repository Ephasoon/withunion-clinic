import { Link } from "react-router";

/**
 * Shown for a role-protected route the user's role may not open, and
 * for a backend 403 on data the page needed. A 403 never signs the user out.
 */
export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <h1 className="text-lg font-semibold">No access</h1>
      <p className="mt-2 text-sm">{message ?? "Your role does not have access to this page."}</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-amber-900 underline">
        Go to home
      </Link>
    </div>
  );
}
