import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">There is no page at this address.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-slate-900 underline">
        Go to home
      </Link>
    </section>
  );
}
