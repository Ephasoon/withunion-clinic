import type { VisitStatus } from "./types";

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  REGISTERED: "Registered",
  WAITING_FOR_NURSE: "Waiting for nurse",
  WITH_NURSE: "With nurse",
  WAITING_FOR_DOCTOR: "Waiting for doctor",
  WITH_DOCTOR: "With doctor",
  WAITING_FOR_LAB: "Waiting for lab",
  AT_LAB: "At lab",
  LAB_COMPLETED: "Lab completed",
  WAITING_FOR_PHARMACY: "Waiting for pharmacy",
  AT_PHARMACY: "At pharmacy",
  WAITING_FOR_BILLING: "Waiting for billing",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Badge colours: waiting = amber, being seen = blue, done = green, cancelled = grey. */
export const VISIT_STATUS_STYLES: Record<VisitStatus, string> = {
  REGISTERED: "bg-slate-100 text-slate-800",
  WAITING_FOR_NURSE: "bg-amber-100 text-amber-900",
  WITH_NURSE: "bg-blue-100 text-blue-900",
  WAITING_FOR_DOCTOR: "bg-amber-100 text-amber-900",
  WITH_DOCTOR: "bg-blue-100 text-blue-900",
  WAITING_FOR_LAB: "bg-amber-100 text-amber-900",
  AT_LAB: "bg-blue-100 text-blue-900",
  LAB_COMPLETED: "bg-amber-100 text-amber-900",
  WAITING_FOR_PHARMACY: "bg-amber-100 text-amber-900",
  AT_PHARMACY: "bg-blue-100 text-blue-900",
  WAITING_FOR_BILLING: "bg-amber-100 text-amber-900",
  COMPLETED: "bg-green-100 text-green-900",
  CANCELLED: "bg-slate-200 text-slate-600",
};
