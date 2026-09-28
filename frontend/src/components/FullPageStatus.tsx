/** Full-screen neutral status, used while the session is being checked. */
export function FullPageStatus({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
      <p className="text-sm text-slate-600">{message}</p>
    </div>
  );
}
