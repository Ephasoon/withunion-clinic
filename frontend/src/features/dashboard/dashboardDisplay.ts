import { ALL_ROLES, ROLE_LABELS, isRole } from "../../rbac/roles";
import { TERMINAL_STATUSES, VISIT_STATUSES, type VisitStatus } from "../visits/types";
import { VISIT_STATUS_LABELS } from "../visits/visitStatus";

export interface DisplayRow {
  key: string;
  label: string;
  count: number;
}

/** The 11 non-terminal statuses in workflow order — the keys of dashboard visits.byStatus. */
export const NON_TERMINAL_STATUSES: readonly VisitStatus[] = VISIT_STATUSES.filter(
  (s) => !TERMINAL_STATUSES.includes(s)
);

/**
 * A count record as a display list: every expected key in a fixed order
 * (0 when missing), then any key this build doesn't know — shown with its
 * raw name so a new backend value is never silently dropped.
 */
function toDisplayList(
  record: Record<string, number>,
  expected: readonly string[],
  label: (key: string) => string
): DisplayRow[] {
  const rows = expected.map((key) => ({ key, label: label(key), count: record[key] ?? 0 }));
  const extra = Object.keys(record)
    .filter((key) => !expected.includes(key))
    .map((key) => ({ key, label: key, count: record[key] ?? 0 }));
  return [...rows, ...extra];
}

/** visits.byStatus → rows in workflow order (REGISTERED … WAITING_FOR_BILLING). */
export function byStatusDisplayList(byStatus: Record<string, number>): DisplayRow[] {
  return toDisplayList(byStatus, NON_TERMINAL_STATUSES, (key) => VISIT_STATUS_LABELS[key as VisitStatus] ?? key);
}

/** staff.activeByRole → rows in role order (owner, reception, nurse, doctor, lab tech, pharmacy). */
export function activeByRoleDisplayList(activeByRole: Record<string, number>): DisplayRow[] {
  return toDisplayList(activeByRole, ALL_ROLES, (key) => (isRole(key) ? ROLE_LABELS[key] : key));
}
