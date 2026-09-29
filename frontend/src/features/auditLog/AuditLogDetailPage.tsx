import { Link, useParams } from "react-router";
import { ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { formatJsonValue } from "./auditParams";
import { useAuditLog } from "./queries";

/**
 * GET /audit-logs/:id. before/after values are arbitrary JSON; they are
 * shown as text inside <pre> (React escapes it), never as HTML.
 */
export function AuditLogDetailPage() {
  const { logId = "" } = useParams();
  const query = useAuditLog(logId);

  if (query.isPending) return <LoadingState label="Loading audit entry…" />;
  if (query.isError) {
    return <ErrorState error={query.error} notFound="This audit entry does not exist." onRetry={() => void query.refetch()} />;
  }
  const log = query.data;

  const rows: [string, string][] = [
    ["When", formatDateTime(log.createdAt)],
    ["User", log.user ? `${log.user.fullName} (${log.user.username})` : "—"],
    ["Action", log.action],
    ["Entity", log.entity],
    ["Entity id", log.entityId ?? "—"],
    ["IP address", log.ipAddress ?? "—"],
  ];

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link to="/audit-log" className="text-sm text-slate-600 hover:underline">
          ← Audit log
        </Link>
        <h1 className="mt-1 font-mono text-xl font-semibold text-slate-900">{log.action}</h1>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-slate-600">{label}</dt>
            <dd className="break-all font-mono text-xs text-slate-900 sm:text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["beforeValue", "afterValue"] as const).map((key) => (
          <div key={key} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">{key === "beforeValue" ? "Before" : "After"}</h2>
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 font-mono text-xs text-slate-800">
              {formatJsonValue(log[key])}
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
