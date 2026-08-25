import { z } from "zod";

/**
 * Must stay in sync with the status strings used in
 * modules/roles/roles.ts QUEUE_TRANSITIONS (Phase 1 blueprint §4.1 /
 * §4.4). Kept here rather than editing roles.ts, since roles.ts is
 * existing Phase 2 foundation and this list is visits-module-owned
 * validation, not an RBAC rule.
 */
export const VISIT_STATUSES = [
  "REGISTERED",
  "WAITING_FOR_NURSE",
  "WITH_NURSE",
  "WAITING_FOR_DOCTOR",
  "WITH_DOCTOR",
  "WAITING_FOR_LAB",
  "AT_LAB",
  "LAB_COMPLETED",
  "WAITING_FOR_PHARMACY",
  "AT_PHARMACY",
  "WAITING_FOR_BILLING",
  "COMPLETED",
  "CANCELLED",
] as const;

export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const TERMINAL_STATUSES: VisitStatus[] = ["COMPLETED", "CANCELLED"];

export const CreateVisitSchema = z
  .object({
    patientId: z.string().uuid("patientId must be a valid uuid"),
  })
  .strict();

export type CreateVisitInput = z.infer<typeof CreateVisitSchema>;

/**
 * toStatus excludes REGISTERED — that status only ever occurs at
 * visit creation (POST /visits), never via the transition endpoint.
 * reason is optional at the schema level; transitionVisit() enforces
 * it's required specifically when toStatus is CANCELLED, since that
 * is a business rule (Phase 1 §4.1 note), not a pure shape check.
 */
export const TransitionVisitSchema = z
  .object({
    toStatus: z.enum(VISIT_STATUSES.filter((s) => s !== "REGISTERED") as [VisitStatus, ...VisitStatus[]]),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type TransitionVisitInput = z.infer<typeof TransitionVisitSchema>;
