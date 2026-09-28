import type { VisitStatus } from "./types";
import { VISIT_STATUS_LABELS, VISIT_STATUS_STYLES } from "./visitStatus";

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${VISIT_STATUS_STYLES[status]}`}
    >
      {VISIT_STATUS_LABELS[status]}
    </span>
  );
}
