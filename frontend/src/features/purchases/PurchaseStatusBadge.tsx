import type { PurchaseStatus } from "./types";

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === "RECEIVED" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"
      }`}
    >
      {status === "RECEIVED" ? "Received" : "Pending"}
    </span>
  );
}
