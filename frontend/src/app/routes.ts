import type { ComponentType } from "react";
import { ConsultationPage } from "../features/doctor/ConsultationPage";
import { DoctorQueuePage } from "../features/doctor/DoctorQueuePage";
import { DoctorVisitPage } from "../features/doctor/DoctorVisitPage";
import { BillingQueuePage } from "../features/billing/BillingQueuePage";
import { InvoicePage } from "../features/billing/InvoicePage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { LabOrderPage } from "../features/laboratory/LabOrderPage";
import { PharmacyQueuePage } from "../features/pharmacy/PharmacyQueuePage";
import { PrescriptionPage } from "../features/pharmacy/PrescriptionPage";
import { LabQueuePage } from "../features/laboratory/LabQueuePage";
import { NurseQueuePage } from "../features/nursing/NurseQueuePage";
import { NursingVisitPage } from "../features/nursing/NursingVisitPage";
import { PatientDetailPage } from "../features/patients/PatientDetailPage";
import { PatientSearchPage } from "../features/patients/PatientSearchPage";
import { RegisterPatientPage } from "../features/patients/RegisterPatientPage";
import { TodayQueuePage } from "../features/visits/TodayQueuePage";
import { VisitDetailPage } from "../features/visits/VisitDetailPage";
import { hasRole } from "../rbac/access";
import { ROLES, type Role } from "../rbac/roles";

/**
 * One entry per role-protected screen. The router wraps each in
 * RequireRole, and the shell's navigation lists the entries the
 * current user's role may open, so both come from this one table.
 *
 * `roles` must match the backend requireRole() list of the endpoints
 * the screen depends on (docs/api-inventory.md §5) — the UI may hide
 * more than the backend forbids, but must never offer less protection.
 */
export interface FeatureRoute {
  /** Path relative to the app root, without a leading slash, e.g. "reception/queue". */
  path: string;
  /** Navigation label. Entries without one (detail and form pages) are routed but not listed in the nav. */
  label?: string;
  roles: readonly Role[];
  Component: ComponentType;
}

export const featureRoutes: readonly FeatureRoute[] = [
  // GET /visits/today is open to any role, but only reception and owner see every status (§3.4).
  { path: "visits/today", label: "Today’s queue", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: TodayQueuePage },
  // GET /visits/:id is open to any role; the actions on it are reception's and owner's (§3.2).
  { path: "visits/:visitId", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: VisitDetailPage },
  // GET /patients is open to any role; registering (POST /patients) is reception only.
  { path: "patients", label: "Patients", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: PatientSearchPage },
  { path: "patients/new", roles: [ROLES.RECEPTION], Component: RegisterPatientPage },
  // GET /patients/:id and /:id/visits are open to any role; creating a visit (POST /visits) is reception only.
  { path: "patients/:patientId", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: PatientDetailPage },
  // Nursing: GET /visits/today is role-scoped to WAITING_FOR_NURSE/WITH_NURSE for nurses (§3.4); the owner
  // sees everything and the page filters. Writes (transition to WITH_NURSE, vitals, assessment) are nurse-only;
  // the owner may view.
  { path: "nursing/queue", label: "Nurse queue", roles: [ROLES.NURSE, ROLES.OWNER], Component: NurseQueuePage },
  { path: "nursing/visits/:visitId", roles: [ROLES.NURSE, ROLES.OWNER], Component: NursingVisitPage },
  // Doctor: GET /visits/today is role-scoped to WAITING_FOR_DOCTOR/WITH_DOCTOR/LAB_COMPLETED for doctors (§3.4).
  // Every read used here is open to any role; every write (consultations, notes, diagnoses, orders,
  // prescriptions, completion, LAB_COMPLETED → WITH_DOCTOR) is doctor-only. The owner may view.
  { path: "doctor/queue", label: "Doctor queue", roles: [ROLES.DOCTOR, ROLES.OWNER], Component: DoctorQueuePage },
  { path: "doctor/visits/:visitId", roles: [ROLES.DOCTOR, ROLES.OWNER], Component: DoctorVisitPage },
  { path: "doctor/consultations/:consultationId", roles: [ROLES.DOCTOR, ROLES.OWNER], Component: ConsultationPage },
  // Laboratory: GET /laboratory/orders is lab_tech-only on the backend (the owner would get 403), so the
  // queue is lab_tech-only here too. GET /laboratory/orders/:id, /visits/:id and /visits/:id/lab-orders are
  // open to any role, so the owner may view an order; start, results and complete are lab_tech-only.
  { path: "laboratory/queue", label: "Lab queue", roles: [ROLES.LAB_TECH], Component: LabQueuePage },
  { path: "laboratory/orders/:orderId", roles: [ROLES.LAB_TECH, ROLES.OWNER], Component: LabOrderPage },
  // Pharmacy: GET /pharmacy/prescriptions is pharmacy-only on the backend, so the queue is pharmacy-only.
  // GET /pharmacy/prescriptions/:id is open to any role but shows the real inventoryItemId only to pharmacy and
  // owner, and GET /inventory/items (needed to pick and name stock) is owner/pharmacy — so the page is
  // pharmacy + owner. Start, dispense and complete are pharmacy-only; the owner views.
  { path: "pharmacy/queue", label: "Pharmacy queue", roles: [ROLES.PHARMACY], Component: PharmacyQueuePage },
  { path: "pharmacy/prescriptions/:prescriptionId", roles: [ROLES.PHARMACY, ROLES.OWNER], Component: PrescriptionPage },
  // Inventory: GET /inventory/items is owner/pharmacy; POST is owner-only (the page shows the form to the owner only).
  { path: "inventory", label: "Inventory", roles: [ROLES.PHARMACY, ROLES.OWNER], Component: InventoryPage },
  // Billing: GET /billing/invoices is reception-only on the backend, so the work queue is reception-only.
  // GET /billing/invoices/:id, /visits/:id/invoice and the receipts are reception + owner; every write
  // (create, items, payments, complete) is reception-only, so the owner views.
  { path: "billing", label: "Billing", roles: [ROLES.RECEPTION], Component: BillingQueuePage },
  { path: "billing/visits/:visitId", roles: [ROLES.RECEPTION, ROLES.OWNER], Component: InvoicePage },
];

export function navItemsFor(user: { role: string } | null): readonly (FeatureRoute & { label: string })[] {
  return featureRoutes.filter(
    (route): route is FeatureRoute & { label: string } => route.label !== undefined && hasRole(user, ...route.roles)
  );
}
