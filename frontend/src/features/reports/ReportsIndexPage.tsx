import { Navigate } from "react-router";

/** /reports opens the first report. */
export function ReportsIndexPage() {
  return <Navigate to="/reports/visits" replace />;
}
