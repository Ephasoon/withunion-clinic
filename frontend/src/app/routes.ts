import type { ComponentType } from "react";
import { AuditLogDetailPage } from "../features/auditLog/AuditLogDetailPage";
import { AuditLogPage } from "../features/auditLog/AuditLogPage";
import { ConsultationPage } from "../features/doctor/ConsultationPage";
import { DoctorQueuePage } from "../features/doctor/DoctorQueuePage";
import { DoctorVisitPage } from "../features/doctor/DoctorVisitPage";
import { BillingQueuePage } from "../features/billing/BillingQueuePage";
import { InvoicePage } from "../features/billing/InvoicePage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { InventoryPage } from "../features/inventory/InventoryPage";
import { DispensingReportPage } from "../features/reports/DispensingReportPage";
import { FinancialReportPage } from "../features/reports/FinancialReportPage";
import { PurchasingReportPage } from "../features/reports/PurchasingReportPage";
import { CreatePurchasePage } from "../features/purchases/CreatePurchasePage";
import { PurchaseDetailPage } from "../features/purchases/PurchaseDetailPage";
import { PurchasesListPage } from "../features/purchases/PurchasesListPage";
import { CreatePriceListItemPage } from "../features/priceList/CreatePriceListItemPage";
import { PriceListItemDetailPage } from "../features/priceList/PriceListItemDetailPage";
import { PriceListPage } from "../features/priceList/PriceListPage";
import { ReportsIndexPage } from "../features/reports/ReportsIndexPage";
import { VisitsReportPage } from "../features/reports/VisitsReportPage";
import { CreateSupplierPage } from "../features/suppliers/CreateSupplierPage";
import { SupplierDetailPage } from "../features/suppliers/SupplierDetailPage";
import { SuppliersListPage } from "../features/suppliers/SuppliersListPage";
import { CreateUserPage } from "../features/users/CreateUserPage";
import { UserDetailPage } from "../features/users/UserDetailPage";
import { UsersListPage } from "../features/users/UsersListPage";
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
  // Dashboard and reports: GET /dashboard and GET /reports/* are owner-only (§5.13, §5.16).
  { path: "dashboard", label: "Dashboard", roles: [ROLES.OWNER], Component: DashboardPage },
  { path: "reports", label: "Reports", roles: [ROLES.OWNER], Component: ReportsIndexPage },
  { path: "reports/visits", roles: [ROLES.OWNER], Component: VisitsReportPage },
  { path: "reports/financial", roles: [ROLES.OWNER], Component: FinancialReportPage },
  { path: "reports/purchasing", roles: [ROLES.OWNER], Component: PurchasingReportPage },
  { path: "reports/pharmacy-dispensing", roles: [ROLES.OWNER], Component: DispensingReportPage },
  // Users: every /users route is owner-only (§5.2).
  { path: "users", label: "Users", roles: [ROLES.OWNER], Component: UsersListPage },
  { path: "users/new", roles: [ROLES.OWNER], Component: CreateUserPage },
  { path: "users/:userId", roles: [ROLES.OWNER], Component: UserDetailPage },
  // Suppliers and purchases: every /suppliers and /purchases route is owner-only, reads included (§5.14, §5.15).
  { path: "suppliers", label: "Suppliers", roles: [ROLES.OWNER], Component: SuppliersListPage },
  { path: "suppliers/new", roles: [ROLES.OWNER], Component: CreateSupplierPage },
  { path: "suppliers/:supplierId", roles: [ROLES.OWNER], Component: SupplierDetailPage },
  { path: "purchases", label: "Purchases", roles: [ROLES.OWNER], Component: PurchasesListPage },
  { path: "purchases/new", roles: [ROLES.OWNER], Component: CreatePurchasePage },
  { path: "purchases/:purchaseId", roles: [ROLES.OWNER], Component: PurchaseDetailPage },
  // Price List: GET /price-list is owner + reception (reception reads it only for Billing's "Add charges"
  // picker); GET /price-list/:id, POST and PATCH are owner-only (§5.17), so managing it is owner-only.
  { path: "price-list", label: "Price List", roles: [ROLES.OWNER], Component: PriceListPage },
  { path: "price-list/new", roles: [ROLES.OWNER], Component: CreatePriceListItemPage },
  { path: "price-list/:itemId", roles: [ROLES.OWNER], Component: PriceListItemDetailPage },
  // Audit log: GET /audit-logs and /audit-logs/:id are owner-only and read-only (§5.12).
  { path: "audit-log", label: "Audit log", roles: [ROLES.OWNER], Component: AuditLogPage },
  { path: "audit-log/:logId", roles: [ROLES.OWNER], Component: AuditLogDetailPage },
];

export function navItemsFor(user: { role: string } | null): readonly (FeatureRoute & { label: string })[] {
  return featureRoutes.filter(
    (route): route is FeatureRoute & { label: string } => route.label !== undefined && hasRole(user, ...route.roles)
  );
}
