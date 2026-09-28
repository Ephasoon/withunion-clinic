import type { ReactNode } from "react";
import { describeApiError } from "../lib/errorMessages";

/** Loading, error and empty views shared by every list and detail page. */

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="py-8 text-center text-sm text-slate-500">
      {label}
    </p>
  );
}

export function ErrorState({
  error,
  notFound,
  onRetry,
}: {
  error: unknown;
  notFound?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{describeApiError(error, { notFound })}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 font-medium text-red-900 underline hover:no-underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/** Inline error for a failed mutation, shown next to the control that caused it. */
export function MutationError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {describeApiError(error)}
    </p>
  );
}
