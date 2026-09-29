import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EmptyState, ErrorState, LoadingState } from "../../components/QueryStates";
import { formatDateTime } from "../../lib/dates";
import { useUsers } from "../users/queries";
import {
  AUDIT_PAGE_SIZES,
  AUDIT_TEXT_MAX,
  auditLogParams,
  EMPTY_AUDIT_FILTERS,
  pageInfo,
  validateAuditFilters,
  type AuditFilterErrors,
  type AuditFilters,
} from "./auditParams";
import { useAuditLogs } from "./queries";
import type { AuditLogPage as AuditLogResult } from "./types";

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none aria-[invalid=true]:border-red-500";

const TEXT_FIELDS: { key: "entity" | "entityId" | "action"; label: string; placeholder: string }[] = [
  { key: "entity", label: "Entity", placeholder: "e.g. suppliers" },
  { key: "entityId", label: "Entity id", placeholder: "Exact id" },
  { key: "action", label: "Action", placeholder: "e.g. supplier.update" },
];

/** GET /audit-logs (owner): filter form and a paginated table, newest first. Read-only. */
export function AuditLogPage() {
  const users = useUsers();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [errors, setErrors] = useState<AuditFilterErrors>({});
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [limit, setLimit] = useState<number>(AUDIT_PAGE_SIZES[0]);
  const [offset, setOffset] = useState(0);
  const logs = useAuditLogs(auditLogParams(applied, { limit, offset }));

  const update = (key: keyof AuditFilters, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateAuditFilters(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setApplied(draft);
    setOffset(0);
  };

  const onClear = () => {
    setDraft(EMPTY_AUDIT_FILTERS);
    setErrors({});
    setApplied(EMPTY_AUDIT_FILTERS);
    setOffset(0);
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Audit log</h1>
        <p className="text-sm text-slate-500">Every recorded change, newest first. Viewing the log is not itself recorded.</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`audit-${f.key}`} className="text-xs font-medium text-slate-600">
              {f.label}
            </label>
            <input
              id={`audit-${f.key}`}
              value={draft[f.key]}
              maxLength={AUDIT_TEXT_MAX}
              placeholder={f.placeholder}
              onChange={(e) => update(f.key, e.target.value)}
              aria-invalid={errors[f.key] ? true : undefined}
              className={inputClass}
            />
            {errors[f.key] && <p className="mt-0.5 text-xs text-red-700">{errors[f.key]}</p>}
          </div>
        ))}
        <div>
          <label htmlFor="audit-userId" className="text-xs font-medium text-slate-600">
            User
          </label>
          <select id="audit-userId" value={draft.userId} onChange={(e) => update("userId", e.target.value)} className={inputClass}>
            <option value="">{users.isPending ? "Loading users…" : "Any user"}</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.username}){u.isActive ? "" : " — inactive"}
              </option>
            ))}
          </select>
          {users.isError && <p className="mt-0.5 text-xs text-red-700">Couldn’t load users; the user filter is unavailable.</p>}
        </div>
        <div>
          <label htmlFor="audit-dateFrom" className="text-xs font-medium text-slate-600">
            From (inclusive)
          </label>
          <input id="audit-dateFrom" type="date" value={draft.dateFrom} onChange={(e) => update("dateFrom", e.target.value)} aria-invalid={errors.dateFrom ? true : undefined} className={inputClass} />
          {errors.dateFrom && <p className="mt-0.5 text-xs text-red-700">{errors.dateFrom}</p>}
        </div>
        <div>
          <label htmlFor="audit-dateTo" className="text-xs font-medium text-slate-600">
            To (inclusive)
          </label>
          <input id="audit-dateTo" type="date" value={draft.dateTo} onChange={(e) => update("dateTo", e.target.value)} aria-invalid={errors.dateTo ? true : undefined} className={inputClass} />
          {errors.dateTo && <p className="mt-0.5 text-xs text-red-700">{errors.dateTo}</p>}
        </div>
        <div className="flex items-end gap-3">
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Apply filters
          </button>
          <button type="button" onClick={onClear} className="text-sm text-slate-600 hover:underline">
            Clear
          </button>
        </div>
      </form>

      {logs.isPending ? (
        <LoadingState label="Loading audit log…" />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : logs.data.logs.length === 0 ? (
        <EmptyState>{logs.data.total > 0 ? "No entries on this page." : "No audit entries match these filters."}</EmptyState>
      ) : (
        <AuditTable
          page={logs.data}
          fetching={logs.isFetching}
          limit={limit}
          onLimit={(l) => {
            setLimit(l);
            setOffset(0);
          }}
          onOffset={setOffset}
        />
      )}
      {logs.isSuccess && logs.data.logs.length === 0 && offset > 0 && (
        <button type="button" onClick={() => setOffset(0)} className="text-sm text-slate-600 hover:underline">
          Back to the first page
        </button>
      )}
    </section>
  );
}

function AuditTable({
  page,
  fetching,
  limit,
  onLimit,
  onOffset,
}: {
  page: AuditLogResult;
  fetching: boolean;
  limit: number;
  onLimit: (limit: number) => void;
  onOffset: (offset: number) => void;
}) {
  const info = pageInfo({ total: page.total, limit: page.limit, offset: page.offset, count: page.logs.length });
  return (
    <div className="space-y-3">
      <div className={`overflow-x-auto rounded-lg border border-slate-200 bg-white ${fetching ? "opacity-60" : ""}`}>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Entity</th>
              <th className="px-4 py-2">Entity id</th>
              <th className="px-4 py-2"><span className="sr-only">Details</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {page.logs.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-2">{formatDateTime(log.createdAt)}</td>
                <td className="px-4 py-2">{log.user ? log.user.fullName : <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-2 font-mono text-xs">{log.entity}</td>
                <td className="max-w-[16rem] truncate px-4 py-2 font-mono text-xs" title={log.entityId ?? undefined}>
                  {log.entityId ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link to={`/audit-log/${log.id}`} className="text-sm font-medium text-slate-900 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-slate-600" aria-live="polite">
          Showing {info.from}–{info.to} of {info.total.toLocaleString()}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-slate-600">
            Per page
            <select value={limit} onChange={(e) => onLimit(Number(e.target.value))} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
              {AUDIT_PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!info.hasPrevious || fetching} onClick={() => onOffset(info.previousOffset)} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50">
            Previous
          </button>
          <button type="button" disabled={!info.hasNext || fetching} onClick={() => onOffset(info.nextOffset)} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
