# WithUnion Clinic Management System
## Phase 1 — Discovery & Technical Blueprint

**Prepared for:** WithUnion
**Status:** Draft for review — no implementation started
**Scope:** V1, single clinic, cloud-hosted, no insurance, no AI diagnosis

---

## 1. Executive Summary

This document is the discovery output requested before any code is written. It covers requirements, roles, workflow state machines, the module list, the database design, the API boundary, the security model, and the infrastructure plan. It also flags every ambiguity in the source brief along with a recommended default, so WithUnion can approve or override each one before Phase 2 begins.

Nothing here has been built yet. Once this is approved (as-is or with corrections), Phase 2 (project foundation) starts.

---

## 2. Requirements Specification

### 2.1 Functional requirements (grouped by module)

| # | Module | Must-have in V1 |
|---|--------|------------------|
| 1 | Auth & Users | Login, logout, password reset, role assignment, deactivate (not delete) |
| 2 | Patients | Register, search/dedupe, view profile, longitudinal history |
| 3 | Visits & Queue | Create visit, move through workflow stages, cancel visit |
| 4 | Nursing | Vitals entry, chief complaint, nursing notes |
| 5 | Doctor Consultation | Notes, diagnosis, lab request, prescription, follow-up |
| 6 | Laboratory | Receive request, enter results, submit to doctor |
| 7 | Pharmacy | Receive prescription, check stock, dispense, update stock |
| 8 | Inventory | Items, batches, stock ledger, expiry, low-stock alerts |
| 9 | Suppliers & Purchasing | Supplier records, purchase orders, stock receiving |
| 10 | Billing & Payments | Invoice generation, payment recording, balances |
| 11 | Receipts | 80mm thermal ESC/POS receipt printing |
| 12 | Appointments | Create, track, mark completed/missed/cancelled |
| 13 | Owner Dashboard | Patient, clinical, financial, inventory metrics |
| 14 | Reports | Filterable reports across all domains above |
| 15 | Audit Log | Who/what/when/before/after for sensitive actions |

### 2.2 Non-functional requirements

- **Security:** HTTPS everywhere, hashed passwords, server-side authorization on every endpoint, audit logging, encrypted secrets.
- **Reliability:** Automated daily backups with verified restore procedure.
- **Performance:** Fast enough on 4 GB RAM Android tablets over Wi-Fi; no page should feel sluggish on a 10 Mbps connection.
- **Usability:** Nurse can log vitals in under ~30 seconds; doctor can open a patient and start charting in one or two taps; pharmacy dispensing should take minimal clicks.
- **Extensibility:** Adding a new vital-sign field, a new report, or a second clinic (multi-tenancy) should not require a schema rewrite.
- **Localization:** English first; all UI strings run through an i18n layer so Amharic can be added without touching component code.
- **Auditability:** Every clinical, financial, and inventory-changing action is traceable to a specific user and timestamp.

### 2.3 Explicit out-of-scope for V1 (confirmed exclusions)

Insurance, patient mobile app, payment gateway integration, SMS/WhatsApp, telemedicine, multi-branch management, AI diagnosis, national health-system integration, full accounting ERP, inpatient/theatre/ambulance management. These are documented so nobody accidentally scope-creeps them in later phases.

---

## 3. User Roles & Permission Matrix

Six roles, each mapped to individual staff accounts (not shared logins). Roles are data, not hard-coded logic, so a 7th role (e.g., "Manager") could be added later without a redeploy.

| Capability | Owner | Reception | Nurse | Doctor | Lab Tech | Pharmacy |
|---|---|---|---|---|---|---|
| Dashboard & reports | ✅ | limited | ❌ | ❌ | ❌ | ❌ |
| Register/search patients | view | ✅ | view | view | view | view |
| Create visit / queue | view | ✅ | move stage (own step) | move stage (own step) | move stage (own step) | move stage (own step) |
| Vitals & nursing notes | view | ❌ | ✅ | view | ❌ | ❌ |
| Consultation / diagnosis | view | ❌ | ❌ | ✅ | ❌ | ❌ |
| Lab request | view | ❌ | ❌ | ✅ create | ✅ fulfill | ❌ |
| Lab result entry | view | ❌ | ❌ | view | ✅ | ❌ |
| Prescription | view | ❌ | ❌ | ✅ create | ❌ | ✅ fulfill |
| Inventory — operational (receive, dispense, batch stock movement) | view | ❌ | ❌ | ❌ | ❌ | ✅ |
| Inventory — adjustments, write-offs, item/category management | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Billing / payment collection | view (reports only) | ✅ **sole cashier role** | ❌ | ❌ | ❌ | ❌ |
| User management | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Corrections applied (post-Phase-1 review):**
- **Reception/Cashier is the sole role that collects and records patient payments in V1.** Owner retains read/report access to financial data for oversight but does not operate the cash-collection workflow day-to-day.
- **Pharmacy never collects payment.** Pharmacy's billing-adjacent responsibility ends at marking a prescription item dispensed/partially-dispensed/unavailable, which feeds the invoice line — reception is the one who takes the payment against that invoice.
- **Inventory authority is split by type of action, not by module.** Owner/Admin has full authority: create/edit items, set min-stock thresholds, perform manual adjustments, write off expired/damaged/lost stock, and see all stock movements. Pharmacy has operational authority only: receive purchases into batches, dispense against prescriptions, and view stock/expiry status — pharmacy cannot perform manual adjustments or write-offs; those route to Owner/Admin (see §4.4 below).
- **"Move stage (own step)" is intentionally narrower than the original "move stage" — see §4.4** for the exact allowed-transition table.

Enforcement rule: **frontend hides what a role shouldn't see; the backend independently re-checks role on every request.** The frontend check is a UX convenience only — never a security boundary.

---

## 4. Workflow / State Diagrams

### 4.1 Visit state machine

```
REGISTERED
   │
   ▼
WAITING_FOR_NURSE ──(nurse unavailable / skip)──┐
   │                                             │
   ▼                                             │
WITH_NURSE                                       │
   │                                             │
   ▼                                             ▼
WAITING_FOR_DOCTOR ◄────────────────────────────┘
   │
   ▼
WITH_DOCTOR
   │
   ├──(no lab needed)──────────────┐
   │                                │
   ▼                                │
WAITING_FOR_LAB                     │
   │                                │
   ▼                                │
AT_LAB → LAB_COMPLETED              │
   │                                │
   ▼                                │
WITH_DOCTOR (review) ───────────────┘
   │
   ├──(no prescription)────────────┐
   ▼                                │
WAITING_FOR_PHARMACY                │
   │                                │
   ▼                                │
AT_PHARMACY ─────────────────────────┤
   │                                │
   ▼                                ▼
WAITING_FOR_BILLING ◄───────────────┘
   │
   ▼
COMPLETED

(CANCELLED can be entered from any non-terminal state, with a reason.)
```

Key design point: the visit doesn't move linearly through a fixed pipe — it moves through a **directed graph with optional branches**, and the doctor stage can be re-entered after lab results come back. This matches the brief's requirement that not every patient touches every department.

### 4.4 Role-controlled transition table (correction — replaces free-form transitions)

The original draft allowed any of nurse/doctor/lab/pharmacy to "move stage" broadly. That's corrected: **each role may only trigger the specific transitions that belong to its own step of the real workflow.** The backend transition endpoint (`POST /visits/:id/transition`) validates both (a) that the transition is legal per the state graph in §4.1, and (b) that the requesting user's role is the one authorized to fire it.

| From status | To status | Allowed role(s) |
|---|---|---|
| — | `REGISTERED` | Reception |
| `REGISTERED` | `WAITING_FOR_NURSE` | Reception |
| `REGISTERED` | `WAITING_FOR_DOCTOR` (nurse skipped) | Reception (explicit, logged skip) |
| `WAITING_FOR_NURSE` | `WITH_NURSE` | Nurse |
| `WITH_NURSE` | `WAITING_FOR_DOCTOR` | Nurse |
| `WAITING_FOR_DOCTOR` | `WITH_DOCTOR` | Doctor |
| `WITH_DOCTOR` | `WAITING_FOR_LAB` | Doctor |
| `WAITING_FOR_LAB` | `AT_LAB` | Lab Tech |
| `AT_LAB` | `LAB_COMPLETED` | Lab Tech |
| `LAB_COMPLETED` | `WITH_DOCTOR` (review) | Doctor |
| `WITH_DOCTOR` | `WAITING_FOR_PHARMACY` | Doctor |
| `WAITING_FOR_PHARMACY` | `AT_PHARMACY` | Pharmacy |
| `AT_PHARMACY` | `WAITING_FOR_BILLING` | Pharmacy |
| `WITH_DOCTOR` | `WAITING_FOR_BILLING` (no lab/pharmacy needed) | Doctor |
| `WAITING_FOR_BILLING` | `COMPLETED` | Reception |
| *any non-terminal* | `CANCELLED` | Reception or Owner (reason required) |

No role can fire a transition outside its own row — e.g., a nurse cannot push a patient straight to `WAITING_FOR_PHARMACY`, and pharmacy cannot pull a patient out of `WAITING_FOR_DOCTOR`. This table is the single source of truth the backend enforces; it replaces the earlier, looser "staff should only see/modify statuses relevant to their role" description with concrete rules.

### 4.2 Laboratory sub-state machine

`REQUESTED → RECEIVED → IN_PROGRESS → COMPLETED` (or `CANCELLED` at any point before COMPLETED). `COMPLETED` is what triggers "result available to doctor."

### 4.3 Pharmacy dispensing sub-state machine

`PRESCRIBED → CHECKED (stock verified) → DISPENSED | PARTIALLY_DISPENSED | UNAVAILABLE`

---

## 5. Module List

1. **Auth & Identity** — login, sessions/tokens, password reset, role assignment
2. **Patients** — registration, search/dedupe, profile, history timeline
3. **Visits & Queue** — visit creation, state machine, live queue board
4. **Nursing** — vitals form, chief complaint, notes
5. **Consultation** — doctor charting, diagnosis, history review
6. **Laboratory** — request intake, result entry, technician queue
7. **Pharmacy & Dispensing** — prescription fulfillment, stock check
8. **Inventory** — items, batches, stock ledger, FEFO logic, alerts
9. **Suppliers & Purchasing** — supplier CRUD, purchase orders, receiving
10. **Billing & Payments** — invoice builder, payment capture, balances
11. **Receipts / Printing** — ESC/POS thermal print service
12. **Appointments** — scheduling, follow-up tracking
13. **Owner Dashboard** — cross-module KPIs
14. **Reports** — filterable exports across all domains
15. **Audit Log** — immutable action trail
16. **System Config** — clinic info, service price list, payment methods, thresholds (low-stock, expiry window)

---

## 6. Database Entity-Relationship Design

Normalized PostgreSQL schema. Core entities and their relationships (not exhaustive column lists — full DDL comes in Phase 2):

**Identity**
- `users` (id, name, phone/email, password_hash, role_id, is_active, created_at)
- `roles` (id, name) — kept as a table, not an enum, so roles are configurable
- `audit_logs` (id, user_id, action, entity, entity_id, before_value, after_value, ip, created_at)

**Patients**
- `patients` (id, patient_code, full_name, gender, dob, phone, address, emergency_contact, status, created_at)
- `patient_contacts` (id, patient_id, type, value) — supports multiple phones/contacts without repeating columns

**Clinical flow**
- `visits` (id, patient_id, status, created_by, created_at, completed_at)
- `queue_events` (id, visit_id, from_status, to_status, changed_by, changed_at) — append-only, gives a full audit trail of stage transitions for free
- `vital_signs` (id, visit_id, recorded_by, bp, pulse, temp, weight, height, resp_rate, spo2, notes, recorded_at)
- `nursing_assessments` (id, visit_id, nurse_id, chief_complaint, assessment_notes)
- `consultations` (id, visit_id, doctor_id, notes, started_at, completed_at)
- `diagnoses` (id, consultation_id, description, icd_code_nullable)

**Laboratory**
- `laboratory_orders` (id, visit_id, consultation_id, requested_by, status, requested_at)
- `laboratory_order_items` (id, order_id, test_name)
- `laboratory_results` (id, order_item_id, technician_id, result_value, unit, reference_range, notes, resulted_at)

**Pharmacy / prescriptions**
- `prescriptions` (id, visit_id, consultation_id, doctor_id, created_at)
- `prescription_items` (id, prescription_id, medicine_id, strength, dosage, frequency, duration, quantity_prescribed, quantity_dispensed, status)

**Inventory**
- `medicines` (id, name, generic_name, category, dosage_form, unit)
- `inventory_items` (id, medicine_id, sku, min_stock_level, storage_location, status) — separates "the drug" from "the stockable item" so non-medicine consumables can reuse the same ledger later
- `inventory_batches` (id, inventory_item_id, batch_number, expiry_date, purchase_price, selling_price, quantity_on_hand, supplier_id, received_at)
- `stock_movements` (id, batch_id, direction[in/out], quantity, reason, reference_type, reference_id, user_id, created_at) — this is the ledger; `quantity_on_hand` on the batch is a cached/derived value that movements always recompute, never overwrite blindly

**Suppliers & purchasing**
- `suppliers` (id, name, phone, address, contact_person, notes)
- `purchases` (id, supplier_id, purchase_date, received_by, total_cost, notes)
- `purchase_items` (id, purchase_id, inventory_item_id, batch_id, quantity, unit_cost)

**Billing**
- `invoices` (id, visit_id, cashier_id, total, amount_paid, balance, status, created_at)
- `invoice_items` (id, invoice_id, description, item_type[consultation/lab/medicine/other], quantity, unit_price, total)
- `payments` (id, invoice_id, amount, method, recorded_by, paid_at)

**Appointments**
- `appointments` (id, patient_id, doctor_id, scheduled_at, reason, status, follow_up_of_visit_id)

**Relational rules:** every clinical/financial/inventory table carries a `*_by`/`*_id` reference to a `users` row (never nullable for completed records), foreign keys are enforced (no orphaned lab results, no dispensing against a non-existent batch), and multi-row operations (e.g., "dispense medicine → decrement batch → create stock_movement → mark prescription_item dispensed") run inside a single DB transaction so partial failures can't corrupt inventory counts.

**Future SaaS readiness:** every table above will carry a nullable `clinic_id` column from day one, defaulted to the single clinic's row. It costs nothing now and avoids a painful migration later when a second clinic is onboarded.

---

## 7. API Design

REST API, versioned (`/api/v1/...`), JSON responses in a consistent envelope (`{ data, error, meta }`).

**Resource groups:**
- `/auth` — login, logout, refresh, password reset
- `/users` — CRUD (owner only), self-profile
- `/patients` — search, create, get, update, history
- `/visits` — create, get, list (today's queue), transition-status
- `/vitals`, `/nursing-assessments`
- `/consultations`, `/diagnoses`
- `/lab-orders`, `/lab-results`
- `/prescriptions`
- `/medicines`, `/inventory-items`, `/inventory-batches`, `/stock-movements`
- `/suppliers`, `/purchases`
- `/invoices`, `/payments`, `/receipts/:invoiceId/print`
- `/appointments`
- `/dashboard`, `/reports/*`
- `/audit-logs` (owner only)

**Cross-cutting middleware, applied in order:** request logging → auth (JWT or session) → role authorization (per-route allowed-roles list) → input validation (schema-based) → controller → consistent error handler (never leaks stack traces or DB errors to the client, logs the real error server-side).

**Transition endpoint pattern:** instead of a generic `PATCH /visits/:id`, use an explicit `POST /visits/:id/transition` with `{ toStatus, reason? }` — the server validates the transition against the state machine in section 4.1 rather than trusting the client to send a "safe" status.

---

## 8. Security Model

- **Passwords:** bcrypt or argon2, never reversible, never logged.
- **Sessions:** short-lived access token + refresh token, or server-side session with secure/httpOnly/SameSite cookies — final choice depends on whether tablets use the PWA in a browser or an installed shell (see open question 9.4).
- **Authorization:** role-based, enforced server-side on every route via a route-to-role allowlist; the frontend's role-aware navigation is UX only.
- **Input validation:** schema validation (e.g., zod/Joi) on every write endpoint; reject unknown fields.
- **SQL injection:** parameterized queries / ORM only, no string-concatenated SQL.
- **CSRF:** relevant only if cookie-based sessions are used; if using bearer tokens, CSRF risk is largely moot but secure headers still apply.
- **Rate limiting:** on `/auth/login` at minimum, to blunt brute-force attempts.
- **Secrets:** `.env` files, never committed; DB credentials never reach the frontend bundle.
- **Audit logging:** diagnosis changes, lab result edits, inventory adjustments, prescription edits, payment edits, and user changes are logged with before/after values.
- **Backups:** daily automated PostgreSQL dump, stored off the production host, with a documented and periodically tested restore procedure.
- **Deactivation over deletion:** staff who leave get `is_active = false`; their historical records stay attributed to them.

---

## 9. Infrastructure Architecture

```
Internet
   │
  HTTPS (Let's Encrypt / auto-renewed cert)
   │
  Nginx (reverse proxy, TLS termination, static asset serving)
   │
  Node.js/Express API (PM2 or systemd-managed process)
   │
  PostgreSQL (primary data store)
   │
  Backup storage (separate from the DB volume — e.g., off-host object storage)
```

**Server sizing (starting point, matches the brief):** 2–4 vCPU, 4–8 GB RAM, 80–160 GB SSD, Linux.

**Device topology:** 1 reception PC, 4 Android tablets (nurse/doctor/lab/pharmacy), 1 ESC/POS 80mm thermal printer wired to the reception PC, 1 Wi-Fi router, UPS on router + reception PC at minimum.

**Domain:** `clinic.withunion.net` — no separate domain purchase needed for V1.

**PWA specifics:** service worker for fast reload and installability; caching strategy limited to static assets and shell UI — **no offline caching of patient-identifiable clinical data**, per the brief's safety requirement. If offline support is requested later, it needs its own design pass (what's safe to queue locally, how conflicts resolve on sync).

---

## 10. Ambiguities, Risks, and Recommended Defaults

These need a decision before Phase 2 starts. Recommended defaults are the simplest safe option; flag any you want changed.

| # | Ambiguity | Recommendation |
|---|---|---|
| 1 | Auth mechanism: JWT (stateless) vs. server-side sessions? | **Sessions with secure httpOnly cookies** — simpler to revoke instantly (important for "deactivate a user immediately"), and the PWA runs in a browser context where cookies work cleanly. |
| 2 | Can a visit skip nursing entirely (e.g., doctor walks in and sees the patient directly)? | **Allow reception/doctor to fast-track past nursing** with an explicit "skip" action that's logged — brief says workflow must be flexible, not rigid. |
| 3 | Discounts on billing — the brief says "if enabled." | **V1: single flat discount field per invoice, owner-configurable on/off.** No per-item promo engine. |
| 4 | Multiple payments per invoice (partial payments over time)? | **Yes, support it** — `payments` is already a separate table from `invoices`, so partial/multiple payments come for free; invoice `balance` is derived, not stored redundantly. |
| 5 | Should lab technicians see a patient's full history, or just what's needed for the current test? | **Limit to: current request + that patient's *previous lab results only*** — not full clinical notes/diagnoses, per the least-privilege principle in §27 of the brief. |
| 6 | FEFO (first-expire-first-out) — automatic or does pharmacy pick the batch? | **System suggests the FEFO batch by default; pharmacy worker can override** (e.g., splitting a dose across two batches) — full auto-lock risks blocking real dispensing edge cases. |
| 7 | What happens to an invoice if a prescription item later becomes "unavailable"? | **Invoice line stays until reception/pharmacy manually adjusts it** — no silent auto-removal of billed items. |
| 8 | Appointment reminders (no SMS in V1) — how does staff know a follow-up is due? | **Reception dashboard shows "appointments today/this week"** — no outbound notification channel in V1, as SMS/WhatsApp is explicitly excluded. |
| 9 | Tablets: installed PWA shell vs. plain browser tab? | **Recommend installed PWA (Add to Home Screen)** for a more app-like, distraction-free experience on shared clinical tablets; doesn't change the backend, only affects offline/session persistence choices in §9.4/§10.1. |
| 10 | Multi-doctor same day — does the system auto-assign a doctor to a patient, or does reception/queue pick? | **Doctor self-claims the next patient from the queue** ("take next" button) rather than reception assigning — matches "different doctors on different days" without extra scheduling logic. |
| 11 | Redis — the brief says "only if justified." | **Skip it for V1.** At this scale (single clinic, low concurrent users) Postgres + in-process caching is sufficient; add Redis later only if session storage or job queues need it. |
| 12 | Soft-delete scope — which entities get `is_active`/deactivation vs. which are truly immutable once created? | **Users get deactivation. Clinical records (diagnoses, lab results, prescriptions) are never deleted or hidden — corrections happen via an audited amendment, not a delete**, to preserve medico-legal integrity. |

---

## 11. Confirmed Technology Stack

Per the brief's preferred direction, and no reason found to deviate:

- **Frontend:** React + TypeScript, Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** PostgreSQL
- **Reverse proxy:** Nginx
- **Cache/queue:** none in V1 (see ambiguity #11)
- **Deployment:** Linux cloud VPS
- **Version control:** Git/GitHub

This aligns with WithUnion's existing stack experience (Node/Express, React/Vite, PostgreSQL are already in use across RestaurantOS and other WithUnion products), which should shorten the ramp-up.

---

## 11.5 Commercial Data Policy (correction)

No equipment prices, server costs, internet costs, domain costs, or other commercial/procurement figures are to be hard-coded anywhere in the application — not in seed data, not in config defaults, not in code comments used as placeholders. Where the software needs a price at all, it's a **user-editable field** (e.g., service price list in System Config, medicine selling price on the inventory item) set by the clinic/owner at runtime, never a constant baked into the codebase. Procurement/commercial planning figures belong in business planning documents, not in the product.

## 12. Next Steps

1. Review this document and respond to the 12 open items in §10 (approve defaults or override).
2. On approval, Phase 2 begins: repo setup, auth foundation, role system, migrations, and the testing harness — before any clinical screens are built.
3. Phase 3 targets the core loop (reception → queue → nurse → doctor) as a fully working vertical slice, per the brief's phased plan, before laboratory and pharmacy are layered on.

No implementation has started. This document is the blueprint for review only.
