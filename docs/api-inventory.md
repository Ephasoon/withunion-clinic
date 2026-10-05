# WithUnion Clinic — Backend API Inventory

Traced from the source at commit `3140b0f` (every route → handler → schema → service). Nothing here is inferred from design docs; where behaviour was verified by running code rather than reading it, that is stated.

Source roots: `server/src/app.ts`, `server/src/config/env.ts`, `server/src/middleware/*`, `server/src/modules/*`. The role/transition table lives in `server/src/modules/roles/roles.ts` (there is no `modules/visits/roles.ts`).

---

## 1. Conventions that apply to every route

### 1.1 Response envelope

Every JSON response (success and error) has the same three keys:

```jsonc
// success
{ "data": { ... }, "error": null, "meta": null }
// error (AppError)
{ "data": null, "error": { "code": "SOME_CODE", "message": "Human text", "details": null | {...} }, "meta": null }
```

- `meta` is **always `null`** — nothing uses it, including the one paginated endpoint (see 7.1).
- `error.details` is `null` except for `VALIDATION_ERROR` raised by `validateBody`/`validateQuery`, where it is Zod's `error.flatten().fieldErrors`: `Record<fieldName, string[]>`.
- Three error bodies are built **outside** `AppError` and have **no `details` key at all** (not `null` — absent): `INTERNAL_ERROR` (500), the unknown-route `NOT_FOUND` (404), and `RATE_LIMITED` (429).
- Success `data` is always an object keyed by resource name (`{ patient }`, `{ visits }`, …) **except** `GET /api/v1/dashboard`, where `data` *is* the snapshot object, and `GET /api/v1/receipts/invoices/:invoiceId/print`, which returns HTML, not JSON.

### 1.2 Standard errors (not repeated in every route table)

| Code | HTTP | Where it comes from | Applies to |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | `requireAuth` / `requireRole` — no `req.session.user` | every route marked with a role (i.e. everything except `POST /auth/login` and `GET /health`) |
| `FORBIDDEN` | 403 | `requireRole` — "You do not have access to this resource" | every route with a role restriction, when the caller's role is not listed |
| `VALIDATION_ERROR` | 400 | `validateBody` ("Invalid request body") / `validateQuery` ("Invalid query parameters"), `details` = field errors | every route with a body/query schema |
| `VALIDATION_ERROR` | 400 | route-level UUID check — "Invalid id format" (or "Invalid visit id format", "Invalid invoiceId format") | every route with a `:id`-style path param; regex `^[0-9a-f]{8}-…-[0-9a-f]{12}$` (case-insensitive, any UUID version) |
| `NOT_FOUND` | 404 | `notFoundHandler` — "No route for METHOD /path" | any unmatched path/method |
| `INTERNAL_ERROR` | 500 | global `errorHandler` for any non-`AppError` — "Something went wrong. Please try again." | every route. **Verified:** a malformed JSON body returns **500 `INTERNAL_ERROR`**, not 400 (body-parser's 400 is not an `AppError`). An oversized body (>1 MB) goes through the same handler (not run). |

**Check order within a route:** `requireAuth` → `requireRole` → `validateBody`/`validateQuery` → path-UUID check (inside the handler) → service checks. So an invalid body is reported before an invalid path id.

**Strict schemas:** every body schema below is `.strict()` unless noted — unknown keys → 400 `VALIDATION_ERROR`. Nested array-item schemas are **not** strict (unknown keys inside items are silently stripped). Query schemas for audit-logs and reports are strict (unknown query params → 400); the patients query schema is not.

### 1.3 Race-only errors from the visit state machine

Module endpoints that move a visit call the Visits service, which re-checks legality. After the module's own precondition passes, these can only occur under a concurrent change, but the frontend should still handle them generically:

| Code | HTTP | Message |
|---|---|---|
| `VISIT_TERMINAL` | 409 | "Visit is already COMPLETED/CANCELLED and cannot be changed further" |
| `FORBIDDEN` | 403 | "Your role cannot move a visit from X to Y" |

---

## 2. Authentication & session (from `app.ts` / `env.ts`)

| Setting | Value (source) |
|---|---|
| Session store | PostgreSQL table `session` via `connect-pg-simple` |
| Cookie name | `env.SESSION_COOKIE_NAME`, default **`wu_clinic_sid`** |
| `httpOnly` | **`true`** |
| `sameSite` | **`"lax"`** |
| `secure` | **`env.NODE_ENV === "production"`** — `false` in development/test |
| `maxAge` | `env.SESSION_MAX_AGE_MS`, default **28 800 000 ms (8 h)** |
| `resave` / `saveUninitialized` | `false` / `false` (no cookie until login) |
| `rolling` | not set (default `false`) — the cookie is issued at login and **not re-issued on activity**, so the browser cookie expires 8 h after login regardless of use |
| `trust proxy` | `1` (one proxy hop, e.g. nginx) |
| CORS `origin` | `env.CORS_ORIGIN` — a **single origin string**, default **`http://localhost:5173`** |
| CORS `credentials` | **`true`** → the frontend must send requests with credentials (`fetch(..., { credentials: "include" })` / `withCredentials`) |
| JSON body limit | `express.json({ limit: "1mb" })` (nginx example allows 5 MB) |
| Security headers | `helmet()` defaults on every response (sole exception: the receipt print route adds one script hash to `script-src`, see §5.11). **Verified CSP:** `default-src 'self'; … script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; frame-ancestors 'self'; upgrade-insecure-requests`, plus `X-Frame-Options: SAMEORIGIN` |
| CSRF | No CSRF token mechanism exists; protection relies on `SameSite=Lax` + the single-origin CORS policy |

**Session behaviour**

- `POST /auth/login` regenerates the session and stores a **snapshot** of the user (`{ id, fullName, username, role, isActive }`). `requireAuth`/`requireRole` read only this snapshot — they never re-query `users`.
- The user's sessions are **deleted server-side** (next request → 401 `UNAUTHENTICATED`) when an owner changes their **role**, **deactivates** them, or **resets their password**. A plain `fullName` edit or a reactivation does **not** invalidate sessions — so `/auth/me` keeps returning the old `fullName` until the user logs in again.
- Login is rate-limited per client IP: `LOGIN_RATE_LIMIT_MAX` requests per `LOGIN_RATE_LIMIT_WINDOW_MS` (`.env.example`: **10 per 15 min**; code default 10 per 15 min). **All** login attempts count, successful or not. Exceeding it returns **429** `{ data: null, error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." }, meta: null }` with `RateLimit-*` standard headers.

---

## 3. Visit workflow

### 3.1 `VisitStatus` (`modules/visits/visits.schema.ts`)

`REGISTERED`, `WAITING_FOR_NURSE`, `WITH_NURSE`, `WAITING_FOR_DOCTOR`, `WITH_DOCTOR`, `WAITING_FOR_LAB`, `AT_LAB`, `LAB_COMPLETED`, `WAITING_FOR_PHARMACY`, `AT_PHARMACY`, `WAITING_FOR_BILLING`, `COMPLETED`, `CANCELLED`

Terminal: `COMPLETED`, `CANCELLED` (no further transition of any kind → 409 `VISIT_TERMINAL`).

### 3.2 `QUEUE_TRANSITIONS` (`modules/roles/roles.ts`, verbatim)

```ts
reception: [ {from:"__new__",to:"REGISTERED"}, {from:"REGISTERED",to:"WAITING_FOR_NURSE"},
             {from:"REGISTERED",to:"WAITING_FOR_DOCTOR"}, {from:"WAITING_FOR_BILLING",to:"COMPLETED"},
             {from:"*",to:"CANCELLED"} ]
nurse:     [ {from:"WAITING_FOR_NURSE",to:"WITH_NURSE"}, {from:"WITH_NURSE",to:"WAITING_FOR_DOCTOR"} ]
doctor:    [ {from:"WAITING_FOR_DOCTOR",to:"WITH_DOCTOR"}, {from:"WITH_DOCTOR",to:"WAITING_FOR_LAB"},
             {from:"LAB_COMPLETED",to:"WITH_DOCTOR"}, {from:"WITH_DOCTOR",to:"WAITING_FOR_PHARMACY"},
             {from:"WITH_DOCTOR",to:"WAITING_FOR_BILLING"} ]
lab_tech:  [ {from:"WAITING_FOR_LAB",to:"AT_LAB"}, {from:"AT_LAB",to:"LAB_COMPLETED"} ]
pharmacy:  [ {from:"WAITING_FOR_PHARMACY",to:"AT_PHARMACY"}, {from:"AT_PHARMACY",to:"WAITING_FOR_BILLING"} ]
owner:     [ {from:"*",to:"CANCELLED"} ]
```

`canTransition(role, from, to)` is true iff an entry matches (`"*"` matches any non-terminal `from`).

### 3.3 Every transition, who may fire it, and through which endpoint

"Generic" = `POST /api/v1/visits/:id/transition`. The generic endpoint refuses every destination in `ENDPOINT_BLOCKED_TARGETS` plus `COMPLETED` with **403 `FORBIDDEN`** (checked after the terminal and role checks).

| From → To | Role | Generic endpoint | Module endpoint (use this) |
|---|---|---|---|
| (new) → `REGISTERED` | reception | n/a (schema rejects `REGISTERED`) | `POST /visits` |
| `REGISTERED` → `WAITING_FOR_NURSE` | reception | **allowed** | — (generic is the only path) |
| `REGISTERED` → `WAITING_FOR_DOCTOR` | reception | **allowed** (nurse-skip) | — |
| `WAITING_FOR_NURSE` → `WITH_NURSE` | nurse | **allowed** | — (generic is the only path) |
| `WITH_NURSE` → `WAITING_FOR_DOCTOR` | nurse | **allowed** (skips the assessment) | `POST /visits/:id/nursing-assessment` |
| `WAITING_FOR_DOCTOR` → `WITH_DOCTOR` | doctor | **allowed** | `POST /visits/:id/consultations` (opens a consultation too) |
| `WITH_DOCTOR` → `WAITING_FOR_LAB` | doctor | **blocked** — "WAITING_FOR_LAB can only be reached by completing a consultation that has a lab order" | `POST /consultations/:id/complete` |
| `WITH_DOCTOR` → `WAITING_FOR_PHARMACY` | doctor | **blocked** — "WAITING_FOR_PHARMACY can only be reached by completing the consultation" | `POST /consultations/:id/complete` |
| `WITH_DOCTOR` → `WAITING_FOR_BILLING` | doctor | **blocked** — "WAITING_FOR_BILLING can only be reached by completing the consultation or pharmacy work" | `POST /consultations/:id/complete` |
| `WAITING_FOR_LAB` → `AT_LAB` | lab_tech | **allowed** | `POST /laboratory/orders/:id/start` |
| `AT_LAB` → `LAB_COMPLETED` | lab_tech | **blocked** — "LAB_COMPLETED can only be reached by completing laboratory work" | `POST /laboratory/orders/:id/complete` |
| `LAB_COMPLETED` → `WITH_DOCTOR` | doctor | **allowed** | — (generic is the only path; then open a review consultation) |
| `WAITING_FOR_PHARMACY` → `AT_PHARMACY` | pharmacy | **allowed** | `POST /pharmacy/prescriptions/:id/start` |
| `AT_PHARMACY` → `WAITING_FOR_BILLING` | pharmacy | **blocked** (same message as above) | `POST /pharmacy/prescriptions/:id/complete` |
| `WAITING_FOR_BILLING` → `COMPLETED` | reception | **blocked** — "A visit can only be completed through billing completion" | `POST /billing/invoices/:id/complete` (also requires a PAID invoice) |
| any non-terminal → `CANCELLED` | reception, owner | **allowed**, `reason` required | — |

Where both paths are "allowed", the frontend should prefer the module endpoint: it enforces the module's rules and writes the module's audit entries (`lab_order.start`, `pharmacy.start`, …); the generic endpoint only writes `visit.transition`.

**Consultation completion routing** (`POST /consultations/:id/complete`) is decided visit-wide, in priority order: any `REQUESTED` lab order on the visit → `WAITING_FOR_LAB`; else any `PENDING` prescription item on the visit → `WAITING_FOR_PHARMACY`; else `WAITING_FOR_BILLING`.

### 3.4 Per-role "today" queue (`GET /visits/today`)

Only visits **created today** (`created_at >= CURRENT_DATE`, database timezone), ordered by `created_at ASC`:

| Role | Statuses returned |
|---|---|
| owner, reception | all statuses |
| nurse | `WAITING_FOR_NURSE`, `WITH_NURSE` |
| doctor | `WAITING_FOR_DOCTOR`, `WITH_DOCTOR`, `LAB_COMPLETED` |
| lab_tech | `WAITING_FOR_LAB`, `AT_LAB` |
| pharmacy | `WAITING_FOR_PHARMACY`, `AT_PHARMACY` |

---

## 4. Shared response types

Types are the service-layer TypeScript shapes; JSON serialization notes are in section 7. `timestamp` = ISO-8601 UTC string (e.g. `"2026-09-27T19:56:08.790Z"`).

```ts
AuthUser        { id, fullName, username, role: Role, isActive: boolean }
User            { id, fullName, username, role: Role, isActive: boolean, createdAt: timestamp, updatedAt: timestamp }
Patient         { id, patientCode /* "WU-000123" */, fullName, gender: "male"|"female"|"other",
                  dateOfBirth: "YYYY-MM-DD" string|null, approximateAge: number|null,
                  phone: string|null, address: string|null, emergencyContactName: string|null,
                  emergencyContactPhone: string|null, status: "active"|"inactive", notes: string|null,
                  createdBy: uuid, createdAt: timestamp, updatedAt: timestamp }
Visit           { id, patientId, patientCode, patientFullName, status: VisitStatus, createdBy: uuid,
                  createdAt: timestamp, completedAt: timestamp|null, cancelledAt: timestamp|null, cancelReason: string|null }
QueueEvent      { id, visitId, fromStatus: VisitStatus|null /* null only for creation */, toStatus: VisitStatus,
                  changedBy: uuid, reason: string|null, changedAt: timestamp }
VitalSigns      { id, visitId, recordedBy: uuid, bloodPressureSystolic: number|null, bloodPressureDiastolic: number|null,
                  pulseBpm: number|null, temperatureCelsius: string|null, weightKg: string|null, heightCm: string|null,
                  respiratoryRate: number|null, oxygenSaturationPct: number|null, notes: string|null, recordedAt: timestamp }
                  // temperatureCelsius/weightKg/heightCm are NUMERIC columns → JSON strings, e.g. "37.5"
NursingAssessment { id, visitId, nurseId: uuid, chiefComplaint: string|null, assessmentNotes: string|null, createdAt: timestamp }
Consultation    { id, visitId, doctorId: uuid, notes: string|null, startedAt: timestamp, completedAt: timestamp|null }
Diagnosis       { id, consultationId, description: string, createdAt: timestamp }
LabOrderCreated { id, visitId, consultationId, requestedBy: uuid, status: "REQUESTED", requestedAt: timestamp, testNames: string[] }
LabOrderDetail  { id, visitId, consultationId, requestedBy: uuid, requestedByName: string,
                  status: "REQUESTED"|"COMPLETED", requestedAt: timestamp, visitStatus: VisitStatus,
                  patientCode, patientFullName,
                  items: [{ id, testName, result: string|null, resultEnteredBy: uuid|null, resultEnteredAt: timestamp|null }] }
                  // items ordered by testName ASC
PrescriptionCreated { id, visitId, consultationId, doctorId: uuid, createdAt: timestamp,
                  items: [{ id, medicineName, strength: string|null, dosage: string|null, frequency: string|null,
                            duration: string|null, quantityPrescribed: number|null, status: "PENDING" }] }
PharmacyPrescriptionDetail { id, visitId, consultationId, doctorId: uuid, doctorName: string, visitStatus: VisitStatus,
                  patientCode, patientFullName, createdAt: timestamp,
                  items: [{ id, medicineName, strength|null, dosage|null, frequency|null, duration|null,
                            quantityPrescribed: number|null, quantityDispensed: number|null,
                            status: PrescriptionItemStatus, inventoryItemId: uuid|null,
                            dispensedBy: uuid|null, dispensedAt: timestamp|null }] }
                  // items ordered by medicineName ASC
InventoryItem   { id, name, unit, quantityOnHand: number }
InvoiceDetail   { id, visitId, visitStatus: VisitStatus, patientCode, patientFullName, cashierId: uuid,
                  discount: number, status: "OPEN"|"PAID", createdAt: timestamp,
                  items: [{ id, description, quantity: number, unitPrice: number, lineTotal: number }],   // description ASC
                  payments: [{ id, amount: number, method: PaymentMethod, recordedBy: uuid, paidAt: timestamp }], // paidAt ASC
                  subtotal: number, total: number, amountPaid: number, balance: number }
                  // all money values are JSON numbers rounded to 2 dp; total = subtotal − discount; balance = total − amountPaid
Receipt         { receiptNumber /* "RCPT-" + first 8 hex chars of invoice id, uppercased */,
                  clinic: { name, address, phone }, invoiceId, invoiceStatus: "PAID", visitId, patientCode, patientFullName,
                  cashierName, createdAt: timestamp,
                  items: [{ description, quantity, unitPrice, lineTotal }], payments: [{ amount, method, paidAt, recordedByName }],
                  subtotal, discount, total, amountPaid, balance }  // numbers, 2 dp
AuditLogEntry   { id, user: { id, fullName, username } | null, action, entity, entityId: string|null,
                  beforeValue: any|null, afterValue: any|null, ipAddress: string|null, createdAt: timestamp }
Supplier        { id, name, contactPerson: string|null, phone: string|null, email: string|null, address: string|null,
                  isActive: boolean, createdAt: timestamp, updatedAt: timestamp }
PurchaseDetail  { id, supplierId, supplierName, purchaseDate: "YYYY-MM-DD" string, referenceNumber: string|null,
                  notes: string|null, status: "PENDING"|"RECEIVED", createdBy: uuid, createdAt: timestamp,
                  receivedBy: uuid|null, receivedAt: timestamp|null,
                  items: [{ id, inventoryItemId, inventoryItemName, quantity: number, unitCost: number }] } // item name ASC
PriceListItem   { id, name, price: number /* 2 dp */, isActive: boolean, createdBy: uuid, createdAt: timestamp, updatedAt: timestamp }
ChargeNameLink  { id, nameKey: string /* normalized name */, priceListItemId: uuid, createdBy: uuid, createdAt: timestamp }
PatientHistoryVisit = Visit & {
                  consultations: Array<Consultation & { diagnoses: Diagnosis[] }>,  // startedAt ASC
                  prescriptions: PharmacyPrescriptionDetail[],                    // createdAt ASC, inventoryItemId redacted per role
                  labOrders: LabOrderDetail[],                                    // requestedAt ASC
                  vitals: VitalSigns[] }                                          // recordedAt ASC
```

---

## 5. Route inventory

75 routes: `GET /health` + 74 under `/api/v1`. Role column: "any" = any authenticated user; "public" = no auth.

### 5.0 Health

#### `GET /health` — public
- Params/query/body: none.
- **200** `{ data: { status: "ok", database: true } }` / **503** `{ data: { status: "degraded", database: false }, error: null }` (note: 503 still has `error: null`).
- Errors: none of its own.

### 5.1 Auth — `modules/auth`

#### `POST /api/v1/auth/login` — public, rate-limited
- **Body** (`LoginSchema`, **not** strict — extra keys stripped): `{ username: string (1–100), password: string (1–200) }`
- **200** `{ data: { user: AuthUser } }` + `Set-Cookie`.
- **Errors**

| Code | HTTP | Condition |
|---|---|---|
| `RATE_LIMITED` | 429 | more than `LOGIN_RATE_LIMIT_MAX` login requests from this IP in the window (checked first) |
| `VALIDATION_ERROR` | 400 | body fails schema |
| `INVALID_CREDENTIALS` | 401 | unknown username, **inactive** account, or wrong password — deliberately identical |

#### `POST /api/v1/auth/logout` — any
- No params/body. **200** `{ data: { loggedOut: true } }`; destroys the session and clears the cookie.
- Errors: standard only (401).

#### `GET /api/v1/auth/me` — any
- **200** `{ data: { user: AuthUser } }` (the session snapshot, see section 2).
- Errors: standard only (401).

### 5.2 Users — `modules/users` (all owner-only)

#### `GET /api/v1/users` — owner
- **200** `{ data: { users: User[] } }` — all users incl. inactive, ordered by `fullName`. No pagination.

#### `GET /api/v1/users/:id` — owner
- Path: `id` uuid. **200** `{ data: { user: User } }`
- Errors: `NOT_FOUND` 404 "User not found".

#### `POST /api/v1/users` — owner
- **Body** (`CreateUserSchema`): `{ fullName: string (trim, 1–255), username: string (trim, 1–100, /^[a-zA-Z0-9._-]+$/), password: string (8–200), role: Role }`
- **201** `{ data: { user: User } }` (created active).
- **Errors**

| Code | HTTP | Condition |
|---|---|---|
| `USERNAME_ALREADY_EXISTS` | 409 | username taken (pre-check, or unique-violation race) |
| `VALIDATION_ERROR` | 400 | "Unknown role" — role row missing from DB (unreachable with the enum; defensive) |

#### `PATCH /api/v1/users/:id` — owner
- Path: `id` uuid. **Body** (`UpdateUserSchema`): `{ fullName?: string (trim, 1–255), role?: Role, isActive?: boolean }`; at least one required (refine has no path → `details` is `{}`, see 7.2).
- **200** `{ data: { user: User } }`. Role change or deactivation deletes the target's sessions.
- **Errors**

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "User not found" |
| `SELF_DEACTIVATION_NOT_ALLOWED` | 409 | target is the caller and `isActive: false` |
| `SELF_DEMOTION_NOT_ALLOWED` | 409 | target is the caller and `role` ≠ `owner` |
| `LAST_ACTIVE_OWNER` | 409 | change would leave zero active owners (deactivating or demoting the last one) |
| `VALIDATION_ERROR` | 400 | "Unknown role" (defensive, unreachable) |

#### `POST /api/v1/users/:id/reset-password` — owner
- Path: `id` uuid. **Body** (`ResetPasswordSchema`): `{ newPassword: string (8–200) }`
- **200** `{ data: { user: User } }`; deletes all of the target's sessions.
- Errors: `NOT_FOUND` 404 "User not found". (No self-check — an owner can reset their own password, which ends their own session.)

### 5.3 Patients — `modules/patients`

#### `POST /api/v1/patients` — reception
- **Body** (`CreatePatientSchema`): `{ fullName: string (trim, 1–255), gender: "male"|"female"|"other", dateOfBirth?: "YYYY-MM-DD", approximateAge?: int 0–150, phone?: string (trim, ≤32), address?: string (trim, ≤2000), emergencyContactName?: string (≤255), emergencyContactPhone?: string (≤32), notes?: string (≤2000) }` — refine: `dateOfBirth` or `approximateAge` required (error reported on `dateOfBirth`).
- **201** `{ data: { patient: Patient } }` — `patientCode` generated from a DB sequence (`WU-` + 6 digits).
- **Phone uniqueness** (`patients.service.ts` `assertPhoneAvailable`, normalization in `utils/phone.ts`): a patient's own `phone` must not match the phone of **any** other patient, active or inactive. Numbers are compared normalized: every non-digit (spaces incl. unicode spaces, `+`, `-`, parentheses…) stripped, then a leading `251` and then a single leading `0` dropped — so `0935259622`, `+251 935 259 622`, `0935 259 622` and `+251 (0) 935-259-622` are the same number. A missing, blank or too-short phone (fewer than 6 digits left after normalizing) never conflicts. Names are not checked; `emergencyContactPhone` is not checked. POST is always checked.
- Errors: `PATIENT_PHONE_ALREADY_EXISTS` 409 — `details: { patientId, patientCode, fullName }` of the existing patient (if several already share the number: the active one first, then the oldest).
- **Known race:** the check runs inside the insert's transaction, but there is **no unique index** behind it (the dev data already holds duplicates — list them with `npx tsx server/src/db/duplicatePatientPhones.ts`, read-only). Two concurrent registrations with the same number can both pass the check and both be created; nothing catches it afterwards.
- Audits `patient.create` (after value).

#### `GET /api/v1/patients` — any
- **Query** (`SearchPatientsQuerySchema`, not strict): `search?: string (trim, ≤255)`, `limit?: int 1–100, default 20`.
- **200** `{ data: { patients: Patient[] } }` — **only `status = 'active'`**. No `search`: newest first. With `search`: phone contains the digits of `search` (ranked first) OR `fullName ILIKE %search%`, then by name. No offset/total.
- Errors: standard only.

#### `GET /api/v1/patients/:id` — any
- **200** `{ data: { patient: Patient } }`. Errors: `NOT_FOUND` 404 "Patient not found". (Inactive patients are returned.)

#### `GET /api/v1/patients/:id/visits` — any
- The patient's visit history: every visit, **any status including `COMPLETED`/`CANCELLED`**, newest first (`createdAt DESC`). No pagination. Not audited.
- **200** `{ data: { visits: Visit[] } }` — `[]` if the patient has no visits.
- Errors: `NOT_FOUND` 404 "Patient not found".
- Path error message: "Invalid id format".

#### `GET /api/v1/patients/:id/history` — doctor, owner
- The patient's clinical history, for the doctor's consultation page. **Query** (`PatientHistoryQuerySchema`, strict): `excludeVisitId?: uuid` — the visit being worked on, left out. An id that isn't one of this patient's visits excludes nothing; omitted, every visit is returned.
- **200** `{ data: { visits: PatientHistoryVisit[] } }` — every other visit, **any status** (like `/patients/:id/visits`), newest first (`createdAt DESC`), each filled in by the same per-visit functions behind `GET /visits/:id/consultations`, `/prescriptions`, `/lab-orders` and `/vitals`, so each list equals what that route returns (prescriptions redacted per role exactly as there). `[]` if the patient has no other visits. No pagination. Not audited.
- Doctor and owner only — narrower than the per-visit reads it aggregates, which are open to any authenticated role.
- Errors: `NOT_FOUND` 404 "Patient not found"; `VALIDATION_ERROR` 400 for a malformed `excludeVisitId` or an unknown query key.
- Path error message: "Invalid id format".

#### `PATCH /api/v1/patients/:id` — reception
- **Body** (`UpdatePatientSchema`): every create field optional, plus `status?: "active"|"inactive"`. No refine — an **empty body `{}` is accepted** and returns the unchanged patient. Fields cannot be set to `null` (see 7.6); `phone: ""` is accepted and stored as an empty string (a blank phone never conflicts).
- **Phone uniqueness** — the same rule as POST, but checked **only when the PATCH changes the normalized number**: a `phone` that normalizes to the patient's current number (re-sent as is, or re-formatted) is not a change and is not checked. So a patient who already shares a number with another (a legacy duplicate) can still have any other field edited, and can re-send its own number, but cannot be moved onto another patient's number. The patient being edited is excluded from the comparison. Same known race as POST (no unique index).
- **200** `{ data: { patient: Patient } }`. Errors: `NOT_FOUND` 404 "Patient not found"; `PATIENT_PHONE_ALREADY_EXISTS` 409 (details as POST) when the new number belongs to another patient — nothing is written and nothing is audited.
- Audits `patient.update` (before/after) on every successful PATCH. A status change additionally records `patient.deactivate` (`active` → `inactive`) or `patient.reactivate` (`inactive` → `active`), no before/after, as Suppliers' `supplier.deactivate`. Re-sending the current status records only `patient.update`.

### 5.4 Visits — `modules/visits`

#### `POST /api/v1/visits` — reception
- **Body** (`CreateVisitSchema`): `{ patientId: uuid }`
- **201** `{ data: { visit: Visit } }` (status `REGISTERED`, one queue event). No check that the patient is active or has no open visit.
- Errors: `NOT_FOUND` 404 "Patient not found".

#### `GET /api/v1/visits/today` — any
- **200** `{ data: { visits: Visit[] } }` — role-scoped, created-today only (section 3.4).

#### `GET /api/v1/visits/:id` — any
- **200** `{ data: { visit: Visit, history: QueueEvent[] } }` (history `changedAt ASC`).
- Errors: `NOT_FOUND` 404 "Visit not found".

#### `POST /api/v1/visits/:id/transition` — any (legality decided per role/transition)
- **Body** (`TransitionVisitSchema`): `{ toStatus: VisitStatus except "REGISTERED", reason?: string (trim, 1–2000) }`
- **200** `{ data: { visit: Visit } }`
- **Errors** (in check order)

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Visit not found" |
| `VISIT_TERMINAL` | 409 | visit is `COMPLETED`/`CANCELLED` |
| `FORBIDDEN` | 403 | "Your role cannot move a visit from X to Y" — not in `QUEUE_TRANSITIONS` for the caller's role |
| `FORBIDDEN` | 403 | module-owned destination: `WAITING_FOR_LAB`, `LAB_COMPLETED`, `WAITING_FOR_PHARMACY`, `WAITING_FOR_BILLING` (messages in 3.3) |
| `FORBIDDEN` | 403 | `COMPLETED` — "A visit can only be completed through billing completion" |
| `VALIDATION_ERROR` | 400 | `toStatus: "CANCELLED"` without `reason` — "reason is required to cancel a visit" |

### 5.5 Nursing — `modules/nursing` (mounted under `/api/v1/visits`)

#### `POST /api/v1/visits/:id/vitals` — nurse
- **Body** (`RecordVitalsSchema`, all optional): `bloodPressureSystolic` int 30–300, `bloodPressureDiastolic` int 20–200, `pulseBpm` int 20–300, `temperatureCelsius` number 25–45, `weightKg` number 0.5–400, `heightCm` number 20–250, `respiratoryRate` int 4–80, `oxygenSaturationPct` int 30–100, `notes` string (trim, ≤2000). An empty body `{}` is accepted (all-null row).
- **201** `{ data: { vitals: VitalSigns } }` — repeatable (new row each call). Stored precision: temperature 1 dp, weight 2 dp, height 1 dp.
- **Errors**

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Visit not found" |
| `INVALID_VISIT_STATE` | 409 | visit not `WITH_NURSE` |

#### `GET /api/v1/visits/:id/vitals` — any
- **200** `{ data: { vitals: VitalSigns[] } }` (`recordedAt ASC`). **No existence check** — an unknown (well-formed) visit id returns `200` with `[]`.

#### `POST /api/v1/visits/:id/nursing-assessment` — nurse
- **Body** (`RecordNursingAssessmentSchema`): `{ chiefComplaint?: string (trim, ≤2000), assessmentNotes?: string (trim, ≤4000) }`
- **201** `{ data: { assessment: NursingAssessment, visitStatus: "WAITING_FOR_DOCTOR" } }` — upserts the single assessment for the visit, then moves the visit `WITH_NURSE → WAITING_FOR_DOCTOR`. The upsert and the transition are **not** one transaction.
- **Errors**: `NOT_FOUND` 404 "Visit not found"; `INVALID_VISIT_STATE` 409 visit not `WITH_NURSE`; race-only errors (1.3).
- Read it back with `GET /visits/:id/nursing-assessment` (below).

#### `GET /api/v1/visits/:id/nursing-assessment` — any
- **200** `{ data: { assessment: NursingAssessment | null } }` — `null` when the visit exists but no assessment has been recorded yet. Not audited.
- Errors: `NOT_FOUND` 404 "Visit not found". (Unlike `GET /visits/:id/vitals`, this checks that the visit exists.)

### 5.6 Consultation — `modules/consultation` (mounted at `/api/v1`)

Shared guard for every write on an existing consultation (`requireOwnOpenConsultation`):

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Consultation not found" |
| `FORBIDDEN` | 403 | "You can only modify your own consultation record" — caller is not the consultation's doctor |
| `CONSULTATION_COMPLETED` | 409 | consultation already has `completedAt` |

#### `POST /api/v1/visits/:id/consultations` — doctor
- No body. **201** `{ data: { consultation: Consultation } }`. If the visit was `WAITING_FOR_DOCTOR` it moves to `WITH_DOCTOR`; if already `WITH_DOCTOR` (review after lab) no transition.
- **Errors**

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Visit not found" |
| `INVALID_VISIT_STATE` | 409 | visit not `WAITING_FOR_DOCTOR` or `WITH_DOCTOR` |
| `CONSULTATION_ALREADY_OPEN` | 409 | the visit already has an uncompleted consultation (app check, or partial-unique-index race) |
| race-only | — | section 1.3 |

#### `GET /api/v1/visits/:id/consultations` — any
- Every consultation on the visit, oldest first (`startedAt ASC`), each with its diagnoses. Not audited.
- **200** `{ data: { consultations: Array<Consultation & { diagnoses: Diagnosis[] }> } }` — `[]` if none yet. Like `GET /consultations/:id`, it does **not** include lab orders or prescriptions (use the two routes below).
- Errors: `NOT_FOUND` 404 "Visit not found".

#### `GET /api/v1/consultations/:id` — any
- **200** `{ data: { consultation: Consultation, diagnoses: Diagnosis[] } }` (diagnoses `createdAt ASC`). **Does not include** lab orders or prescriptions.
- Errors: `NOT_FOUND` 404 "Consultation not found".

#### `PATCH /api/v1/consultations/:id` — doctor (own, open)
- **Body** (`UpdateConsultationNotesSchema`): `{ notes: string (trim, ≤8000) }` — replaces notes; empty string allowed.
- **200** `{ data: { consultation: Consultation } }`. Errors: shared guard.

#### `POST /api/v1/consultations/:id/diagnoses` — doctor (own, open)
- **Body**: `{ description: string (trim, 1–2000) }`. **201** `{ data: { diagnosis: Diagnosis } }`. Errors: shared guard.

#### `POST /api/v1/consultations/:id/lab-orders` — doctor (own, open)
- **Body** (`CreateLabOrderSchema`): `{ testNames: string[] (1–50 items, each trim 1–255) }`
- **201** `{ data: { labOrder: LabOrderCreated } }` — note the key is **`labOrder`**. Multiple orders per consultation are allowed. Errors: shared guard.

#### `POST /api/v1/consultations/:id/prescriptions` — doctor (own, open)
- **Body** (`CreatePrescriptionSchema`): `{ items: [{ medicineName: string (trim, 1–255), strength?: string (≤100), dosage?: string (≤100), frequency?: string (≤100), duration?: string (≤100), quantityPrescribed?: int 1–100000 }] }` (1–50 items; item objects not strict). `medicineName` is free text — not linked to inventory.
- **201** `{ data: { prescription: PrescriptionCreated } }`. Errors: shared guard.

#### `POST /api/v1/consultations/:id/complete` — doctor (own, open)
- No body. **200** `{ data: { consultation: Consultation, visitStatus: "WAITING_FOR_LAB"|"WAITING_FOR_PHARMACY"|"WAITING_FOR_BILLING" } }` — routing in 3.3.
- **Errors**: shared guard; `VISIT_TERMINAL` 409 / `FORBIDDEN` 403 "Your role cannot move a visit from X to …" when the visit is no longer `WITH_DOCTOR` (e.g. the visit was cancelled while the consultation was open — **not** race-only here).

### 5.7 Laboratory — `modules/laboratory`

#### `GET /api/v1/laboratory/orders` — lab_tech
- **200** `{ data: { orders: LabOrderDetail[] } }` — only orders with `status = 'REQUESTED'` whose visit is `WAITING_FOR_LAB` or `AT_LAB`, `requestedAt ASC`.

#### `GET /api/v1/laboratory/orders/:id` — any
- **200** `{ data: { order: LabOrderDetail } }`. Errors: `NOT_FOUND` 404 "Laboratory order not found".

#### `GET /api/v1/visits/:id/lab-orders` — any
- Every lab order on the visit, **all statuses** (`REQUESTED` and `COMPLETED`, i.e. across lab rounds), oldest first (`requestedAt ASC`). Not audited. Defined in the laboratory module; mounted under `/api/v1/visits`.
- **200** `{ data: { orders: LabOrderDetail[] } }` — `[]` if none.
- Errors: `NOT_FOUND` 404 "Visit not found".

#### `POST /api/v1/laboratory/orders/:id/start` — lab_tech
- No body. **200** `{ data: { order: LabOrderDetail } }` (visit now `AT_LAB`).
- **Errors** (in order): `NOT_FOUND` 404; `INVALID_VISIT_STATE` 409 visit not `WAITING_FOR_LAB`; `LAB_ORDER_NOT_REQUESTED` 409 "Laboratory order is already COMPLETED"; race-only (1.3).

#### `POST /api/v1/laboratory/orders/:id/results` — lab_tech
- **Body** (`EnterResultsSchema`): `{ results: [{ itemId: uuid, result: string (trim, 1–2000) }] }` (1–50). Overwrites existing results for those items.
- **200** `{ data: { order: LabOrderDetail } }`
- **Errors** (in order)

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Laboratory order not found" |
| `INVALID_VISIT_STATE` | 409 | visit not `AT_LAB` |
| `LAB_ORDER_NOT_REQUESTED` | 409 | order already `COMPLETED` (checked before and again under row lock) |
| `ITEM_NOT_IN_ORDER` | 400 | an `itemId` doesn't belong to this order |

#### `POST /api/v1/laboratory/orders/:id/complete` — lab_tech
- No body. Completes the visit's whole lab round: every `REQUESTED` order on the visit must have all results; all of them become `COMPLETED` and the visit moves `AT_LAB → LAB_COMPLETED` in one transaction.
- **200** `{ data: { order: LabOrderDetail } }`
- **Errors** (in order)

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Laboratory order not found" |
| `INVALID_VISIT_STATE` | 409 | visit not `AT_LAB` |
| `LAB_ORDER_NOT_REQUESTED` | 409 | this order already `COMPLETED` (or closed by a concurrent completion) |
| `INCOMPLETE_RESULTS` | 409 | any item on any outstanding order of the visit lacks a non-blank result; message lists test names, other orders' tests suffixed `(order <id>)` |
| race-only | — | section 1.3 |

### 5.8 Pharmacy — `modules/pharmacy`

`PrescriptionItemStatus`: `PENDING`, `PARTIALLY_DISPENSED`, `DISPENSED`, `UNAVAILABLE`.

#### `GET /api/v1/pharmacy/prescriptions` — pharmacy
- **200** `{ data: { prescriptions: PharmacyPrescriptionDetail[] } }` — prescriptions whose visit is `WAITING_FOR_PHARMACY` or `AT_PHARMACY`, `createdAt ASC` (all prescriptions of such a visit, whatever their item status).

#### `GET /api/v1/pharmacy/prescriptions/:id` — any
- **200** `{ data: { prescription: PharmacyPrescriptionDetail } }` — for roles other than pharmacy/owner, every item's **`inventoryItemId` is `null`** (redacted).
- Errors: `NOT_FOUND` 404 "Prescription not found".

#### `GET /api/v1/visits/:id/prescriptions` — any
- Every prescription on the visit, whatever its item statuses, oldest first (`createdAt ASC`). Same redaction as `GET /prescriptions/:id`: for roles other than pharmacy/owner every item's **`inventoryItemId` is `null`**. Not audited. Defined in the pharmacy module; mounted under `/api/v1/visits`.
- **200** `{ data: { prescriptions: PharmacyPrescriptionDetail[] } }` — `[]` if none.
- Errors: `NOT_FOUND` 404 "Visit not found".

#### `POST /api/v1/pharmacy/prescriptions/:id/start` — pharmacy
- No body. **200** `{ data: { prescription: PharmacyPrescriptionDetail } }` (visit now `AT_PHARMACY`).
- Errors: `NOT_FOUND` 404; `INVALID_VISIT_STATE` 409 visit not `WAITING_FOR_PHARMACY`; race-only.

#### `POST /api/v1/pharmacy/prescriptions/:id/dispense` — pharmacy
- **Body** (`DispenseRequestSchema`): `{ items: DispenseEntry[] }` (1–50), each entry **exactly one of** (strict union):
  - `{ itemId: uuid, inventoryItemId: uuid, quantity: int 1–1000000 }` — dispense and decrement stock;
  - `{ itemId: uuid, markUnavailable: true }`.
- Whole batch is one transaction. Resulting item status: `DISPENSED` when `quantityDispensed == quantityPrescribed`, or after one dispense when `quantityPrescribed` is null; otherwise `PARTIALLY_DISPENSED`.
- **200** `{ data: { prescription: PharmacyPrescriptionDetail } }`
- **Errors** (in order; the batch rolls back on the first failure)

| Code | HTTP | Condition |
|---|---|---|
| `NOT_FOUND` | 404 | "Prescription not found" |
| `INVALID_VISIT_STATE` | 409 | visit not `AT_PHARMACY` |
| `ITEM_NOT_IN_PRESCRIPTION` | 400 | `itemId` not on this prescription |
| `ITEM_ALREADY_TERMINAL` | 409 | dispense on a `DISPENSED`/`UNAVAILABLE` item, or mark-unavailable on any non-`PENDING` item |
| `EXCEEDS_PRESCRIBED_QUANTITY` | 400 | cumulative dispensed would exceed `quantityPrescribed` |
| `INSUFFICIENT_STOCK` | 409 | stock item has less than `quantity` — **also returned when `inventoryItemId` does not exist** |

#### `POST /api/v1/pharmacy/prescriptions/:id/complete` — pharmacy
- No body. Requires **no `PENDING` item on any prescription of the visit**, then moves the visit `AT_PHARMACY → WAITING_FOR_BILLING` in the same transaction.
- **200** `{ data: { prescription: PharmacyPrescriptionDetail, visitStatus: "WAITING_FOR_BILLING" } }`
- **Errors**: `NOT_FOUND` 404; `INVALID_VISIT_STATE` 409 visit not `AT_PHARMACY`; `INCOMPLETE_DISPENSING` 409 (lists pending medicines, other prescriptions' suffixed `(prescription <id>)`); race-only.

### 5.9 Inventory — `modules/inventory`

#### `POST /api/v1/inventory/items` — owner
- **Body**: `{ name: string (trim, 1–255), unit: string (trim, 1–50), quantityOnHand: int 0–10000000 }`
- **201** `{ data: { item: InventoryItem } }`
- Errors: `INVENTORY_ITEM_ALREADY_EXISTS` 409 — case/whitespace-insensitive name match. (A unique-violation race is **not** caught here and would surface as 500.)

#### `GET /api/v1/inventory/items` — owner, pharmacy
- **200** `{ data: { items: InventoryItem[] } }` — all items, `name ASC`, no pagination. There is no update/adjust/delete endpoint; stock changes only via dispensing and purchase receiving.

### 5.10 Billing — `modules/billing`

`PaymentMethod`: `cash`, `bank_transfer`, `other`. One invoice per visit.

#### `GET /api/v1/billing/invoices` — reception
- **200** `{ data: { work: [{ visitId, patientCode, patientFullName, invoice: InvoiceDetail | null }] } }` — every visit currently `WAITING_FOR_BILLING` (any date), oldest first; `invoice` is `null` if none created yet.

#### `GET /api/v1/billing/invoices/:id` — reception, owner
- **200** `{ data: { invoice: InvoiceDetail } }`. Errors: `NOT_FOUND` 404 "Invoice not found".

#### `GET /api/v1/visits/:id/invoice` — reception, owner
- The visit's invoice (one per visit), whatever its status and the visit's status. Not audited. Defined in the billing module; mounted under `/api/v1/visits`.
- **200** `{ data: { invoice: InvoiceDetail | null } }` — `null` when the visit exists but no invoice has been created yet.
- Errors: `NOT_FOUND` 404 "Visit not found". Other roles get the standard 403 `FORBIDDEN`.

#### `POST /api/v1/billing/visits/:visitId/invoice` — reception
- No body (any body is ignored — **there is no way to set `discount`; it is always 0**). Path error message: "Invalid visit id format".
- **201** `{ data: { invoice: InvoiceDetail } }` (empty, `OPEN`, caller recorded as cashier).
- **Errors**: `NOT_FOUND` 404 "Visit not found"; `INVALID_VISIT_STATE` 409 visit not `WAITING_FOR_BILLING`; `INVOICE_ALREADY_EXISTS` 409.

#### `POST /api/v1/billing/invoices/:id/items` — reception
- **Body** (`AddInvoiceItemsSchema`): `{ items: [{ description: string (trim, 1–255), quantity: int 1–100000, unitPrice: number 0–10000000 }] }` (1–50).
- **201** `{ data: { invoice: InvoiceDetail } }`
- **Errors**: `NOT_FOUND` 404 "Invoice not found"; `INVOICE_NOT_OPEN` 409 invoice already `PAID`.

#### `POST /api/v1/billing/invoices/:id/payments` — reception
- **Body** (`RecordPaymentSchema`): `{ amount: number > 0, ≤ 100000000, method: PaymentMethod }`
- **201** `{ data: { invoice: InvoiceDetail } }`
- **Errors**: `NOT_FOUND` 404; `INVOICE_NOT_OPEN` 409; `OVERPAYMENT` 400 — `amount` (rounded to 2 dp) exceeds the current `balance`.

#### `POST /api/v1/billing/invoices/:id/complete` — reception
- No body. Marks the invoice `PAID` and the visit `COMPLETED` in one transaction.
- **200** `{ data: { invoice: InvoiceDetail, visitStatus: "COMPLETED" } }`
- **Errors** (in order): `NOT_FOUND` 404; `INVOICE_NOT_OPEN` 409; `INVALID_VISIT_STATE` 409 visit not `WAITING_FOR_BILLING`; `INVOICE_NOT_PAID` 409 balance ≠ 0 (a zero-item invoice completes).

### 5.11 Receipts — `modules/receipts`

#### `GET /api/v1/receipts/invoices/:invoiceId` — reception, owner
- Path error message: "Invalid invoiceId format". **200** `{ data: { receipt: Receipt } }`
- **Errors**: `NOT_FOUND` 404 "Invoice not found"; `RECEIPT_NOT_AVAILABLE_UNTIL_PAID` 409 invoice not `PAID`.

#### `GET /api/v1/receipts/invoices/:invoiceId/print` — reception, owner
- **200** `Content-Type: text/html; charset=utf-8` — **not the JSON envelope**. An 80 mm thermal-receipt page. Dates are formatted server-side with `toLocaleString()` (server locale/timezone). It ends with an inline `<script>window.print();</script>` that auto-opens the print dialog. That script is **explicitly allowed by a hash-based CSP exception scoped to this one route**: the response's CSP is helmet's default policy with `script-src 'self' 'sha256-/rCCQAYo5nH3kqWMvdaSato3ShxLfLrkODJIMZPKHSg='` (the SHA-256 of exactly `window.print();`, derived in `receipts.service.ts` from the same constant the page embeds); every other directive, and every other route's CSP, is unchanged. Open it as a top-level page (e.g. `window.open(url)`) so the session cookie is sent. *Fixed 2026-09-28; before that the app-wide `script-src 'self'` blocked the script and auto-print never fired.*
- Errors: same as above, returned as **JSON** envelopes.

### 5.12 Audit log — `modules/audit-log` (owner-only; viewing is not itself audited)

#### `GET /api/v1/audit-logs` — owner
- **Query** (`AuditLogQuerySchema`, strict): `entity?: string (1–64)`, `entityId?: string (1–64, any string)`, `userId?: uuid`, `action?: string (1–64)`, `dateFrom?`, `dateTo?` (both `z.coerce.date()` — anything `Date` can parse; a bare `YYYY-MM-DD` means **UTC midnight**, and `dateTo` is inclusive `<=`), `limit?: int 1–100, default 20`, `offset?: int 0–1000000, default 0`.
- **200** `{ data: { logs: AuditLogEntry[], total: number, limit: number, offset: number } }` — `createdAt DESC`; `total` is the full filtered count.

#### `GET /api/v1/audit-logs/:id` — owner
- **200** `{ data: { log: AuditLogEntry } }`. Errors: `NOT_FOUND` 404 "Audit log entry not found".

### 5.13 Dashboard — `modules/dashboard`

#### `GET /api/v1/dashboard` — owner
- **200** `data` **is** the snapshot (not wrapped):
```ts
{ generatedAt: timestamp,
  patients: { registeredToday: number },
  visits:   { today: number, completedToday: number, cancelledToday: number,
              byStatus: Record<non-terminal VisitStatus, number> /* all 11 present, 0 if none; counts ALL visits in that status, not just today's */ },
  billing:  { revenueToday: number, paymentsToday: number, openInvoiceCount: number, totalOutstandingBalance: number },
  inventory:{ totalItems: number, outOfStockCount: number /* quantityOnHand = 0 */ },
  staff:    { activeByRole: Record<Role, number> /* all 6 present */, totalActive: number } }
```
- "Today" = database `CURRENT_DATE`. All values are numbers (never null).

### 5.14 Suppliers — `modules/suppliers` (owner-only, including reads)

#### `GET /api/v1/suppliers` — owner — **200** `{ data: { suppliers: Supplier[] } }` (all incl. inactive, `name ASC`).
#### `GET /api/v1/suppliers/:id` — owner — **200** `{ data: { supplier: Supplier } }`; `NOT_FOUND` 404 "Supplier not found".
#### `POST /api/v1/suppliers` — owner
- **Body**: `{ name: string (trim, 1–255), contactPerson?: string (≤255), phone?: string (≤32), email?: email (≤255), address?: string (≤2000) }` — names need not be unique.
- **201** `{ data: { supplier: Supplier } }`. Errors: standard only.
#### `PATCH /api/v1/suppliers/:id` — owner
- **Body**: create fields all optional + `isActive?: boolean`; at least one key (refine without path → `details` `{}`).
- **200** `{ data: { supplier: Supplier } }`. Errors: `NOT_FOUND` 404 "Supplier not found".

### 5.15 Purchases — `modules/purchases` (owner-only)

#### `GET /api/v1/purchases` — owner — **200** `{ data: { purchases: PurchaseDetail[] } }` (`createdAt DESC`, with items, no pagination).
#### `GET /api/v1/purchases/:id` — owner — **200** `{ data: { purchase: PurchaseDetail } }`; `NOT_FOUND` 404 "Purchase not found".
#### `POST /api/v1/purchases` — owner
- **Body** (`CreatePurchaseSchema`): `{ supplierId: uuid, purchaseDate: "YYYY-MM-DD", referenceNumber?: string (≤100), notes?: string (≤2000), items: [{ inventoryItemId: uuid, quantity: int 1–1000000, unitCost: number 0–10000000 }] (1–50) }`
- **201** `{ data: { purchase: PurchaseDetail } }` (status `PENDING`; stock untouched). Inactive suppliers are accepted.
- **Errors**: `NOT_FOUND` 404 "Supplier not found"; `INVALID_INVENTORY_ITEM` 400 "Inventory item <id> does not exist" (whole purchase rolled back).
#### `POST /api/v1/purchases/:id/receive` — owner
- No body. Increments stock for every item and sets `RECEIVED`, one transaction.
- **200** `{ data: { purchase: PurchaseDetail } }`
- **Errors**: `NOT_FOUND` 404 "Purchase not found"; `PURCHASE_ALREADY_RECEIVED` 409.

### 5.16 Reports — `modules/reports` (owner-only)

All four share a strict query schema: `dateFrom?: "YYYY-MM-DD"`, `dateTo?: "YYYY-MM-DD"`, refine `dateFrom <= dateTo` (error on `dateFrom`). Defaults: `dateFrom` = today − 29 days, `dateTo` = today (database date). Ranges are inclusive days. All response dates in reports are plain `"YYYY-MM-DD"` strings, like every other `DATE` value in the API (§7.3). Reports produces its per-day/per-month buckets with `to_char(...)` in SQL, so those date strings are formatted by PostgreSQL rather than read from a `DATE` column. No route-specific errors beyond the standard ones.

#### `GET /api/v1/reports/visits` — owner
- Extra query: `status?: VisitStatus`.
- **200** `{ data: { report: { dateFrom, dateTo, status: string|null, totalCount: number, byStatus: [{ status, count }], byDate: [{ date: "YYYY-MM-DD", count }] } } }` — filtered on visit `created_at`.

#### `GET /api/v1/reports/financial` — owner
- Extra query: `groupBy?: "day"|"month"`, default `"day"`.
- **200** `{ data: { report: { dateFrom, dateTo, groupBy, totalRevenue: number, paymentCount: number, byMethod: [{ method, total, count }], byPeriod: [{ period: "YYYY-MM-DD"|"YYYY-MM", total, count }], outstandingInvoices: [{ invoiceId, visitId, patientCode, patientFullName, createdAt: timestamp, subtotal, discount, total, amountPaid, balance }] } } }` — revenue filtered on `paid_at`; outstanding = `OPEN` invoices **created** in range with balance > 0.

#### `GET /api/v1/reports/purchasing` — owner
- Extra query: `supplierId?: uuid`, `status?: "PENDING"|"RECEIVED"`.
- **200** `{ data: { report: { dateFrom, dateTo, supplierId: string|null, status: string|null, totalPurchases, totalQuantity, totalCost, byStatus: [{ status, purchaseCount, totalQuantity, totalCost }], bySupplier: [{ supplierId, supplierName, purchaseCount, totalQuantity, totalCost }], byDate: [{ date, purchaseCount, totalQuantity, totalCost }] } } }` — filtered on `purchase_date`.

#### `GET /api/v1/reports/pharmacy-dispensing` — owner
- Extra query: `status?: PrescriptionItemStatus`.
- **200** `{ data: { report: { dateFrom, dateTo, status: string|null, totalItemsDispensed, totalQuantityDispensed, byStatus: [{ status, itemCount, totalQuantityDispensed }], byDate: [{ date, itemCount, totalQuantityDispensed }] } } }` — only items with `dispensed_at` in range, so `PENDING`/`UNAVAILABLE` filters always return zero rows (documented limitation).

### 5.17 Price List — `modules/price-list` (owner-only, except the list, which reception can also read)

#### `GET /api/v1/price-list` — owner, reception — **200** `{ data: { items: PriceListItem[] } }` (all incl. inactive, `name ASC`, no pagination). Reception reads it to pick charges when billing (same read/write split as Inventory's owner + pharmacy listing); it gets the full list, inactive items and `createdBy` included, so callers filter to `isActive` themselves.
#### `GET /api/v1/price-list/:id` — owner — **200** `{ data: { item: PriceListItem } }`; `NOT_FOUND` 404 "Price list item not found".
#### `POST /api/v1/price-list` — owner
- **Body**: `{ name: string (trim, 1–255), price: number 0–10000000, ≤2 decimals }` — more than 2 decimals is a `VALIDATION_ERROR` on `price` (not rounded, unlike billing/purchases money inputs). `createdBy` = the session user.
- **201** `{ data: { item: PriceListItem } }`
- Errors: `PRICE_LIST_ITEM_ALREADY_EXISTS` 409 — case/whitespace-insensitive name match. (A unique-violation race is **not** caught here and would surface as 500.)
#### `PATCH /api/v1/price-list/:id` — owner
- **Body**: create fields all optional + `isActive?: boolean`; at least one key (refine without path → `details` `{}`).
- **200** `{ data: { item: PriceListItem } }`. Errors: `NOT_FOUND` 404 "Price list item not found"; `PRICE_LIST_ITEM_ALREADY_EXISTS` 409 when `name` matches **another** item (re-casing an item's own name is allowed).
- Audits `price_list_item.update` (before/after); a deactivation (`isActive: false` on an active item) additionally records `price_list_item.deactivate`, as Suppliers does.

### 5.18 Charge links — `modules/charge-links` (owner, reception)

Billing's saved answers to "which price-list item is this medicine / lab test charged as?", used by the invoice page's charge suggestions. Table `charge_name_links` (`id` uuid PK, `name_key` text — unique index `charge_name_links_name_key_idx`, `price_list_item_id` → `price_list_items` ON DELETE RESTRICT, `created_by` → `users`, `created_at`). `name_key` is the normalized name from `utils/chargeName.ts`: trimmed, every whitespace run (unicode spaces included) collapsed to one space, lowercased. Matching is exact equality of normalized names — nothing fuzzy. No delete endpoint.

#### `GET /api/v1/charge-links` — owner, reception — **200** `{ data: { links: ChargeNameLink[] } }` (all, `nameKey ASC`, no pagination). Links whose price-list item is now inactive are still returned; callers check `isActive` against `GET /price-list`. Not audited.
#### `PUT /api/v1/charge-links` — owner, reception
- **Body**: `{ name: string (trim, 1–255), priceListItemId: uuid }` (strict). The server normalizes `name` into `nameKey`.
- Upsert by `nameKey`: **201** `{ data: { link: ChargeNameLink } }` when created, **200** when the existing link for that name was replaced (same `id`; `priceListItemId`, `createdBy` and `createdAt` become the new saver's).
- Errors: `NOT_FOUND` 404 "Price list item not found"; `PRICE_LIST_ITEM_INACTIVE` 409 when the item is inactive (an existing link is left unchanged).
- Audits `charge_link.save` with `before` (`null` on create) and `after` (`ChargeNameLink`).

---

## 6. Error catalog (deduplicated)

| Code | HTTP | Meaning / message | Source file(s) | Condition |
|---|---|---|---|---|
| `UNAUTHENTICATED` | 401 | "You must be logged in" | `middleware/auth.ts` | no session user |
| `FORBIDDEN` | 403 | "You do not have access to this resource" | `middleware/auth.ts` | role not allowed on route |
| `FORBIDDEN` | 403 | "Your role cannot move a visit from X to Y" | `visits/visits.service.ts` | `canTransition` false |
| `FORBIDDEN` | 403 | "<STATUS> can only be reached by …" / "A visit can only be completed through billing completion" | `visits/visits.service.ts` | generic endpoint targeting a module-owned status or `COMPLETED` |
| `FORBIDDEN` | 403 | "A visit cannot be completed without a PAID invoice" | `visits/visits.service.ts` | billing completion with no PAID invoice (defensive; unreachable via API) |
| `FORBIDDEN` | 403 | "You can only modify your own consultation record" | `consultation/consultation.service.ts` | another doctor's consultation |
| `VALIDATION_ERROR` | 400 | "Invalid request body" / "Invalid query parameters" (+ `details`) | `middleware/validate.ts` | Zod failure |
| `VALIDATION_ERROR` | 400 | "Invalid id format" / "Invalid visit id format" / "Invalid invoiceId format" | every `*.routes.ts` with a path id | path param not UUID-shaped |
| `VALIDATION_ERROR` | 400 | "reason is required to cancel a visit" | `visits/visits.service.ts` | cancel without reason |
| `VALIDATION_ERROR` | 400 | "Unknown role …" | `users/users.service.ts` | role row missing (defensive) |
| `NOT_FOUND` | 404 | "<Resource> not found" | patients, users, visits, nursing, consultation, laboratory, pharmacy, billing, receipts, audit-log, suppliers, purchases, price-list, charge-links | id well-formed but no row |
| `NOT_FOUND` | 404 | "No route for METHOD /path" (no `details` key) | `middleware/errorHandler.ts` | unmatched route |
| `INVALID_CREDENTIALS` | 401 | "Invalid username or password" | `auth/auth.routes.ts` | bad username/password or inactive |
| `RATE_LIMITED` | 429 | "Too many login attempts. Try again later." (no `details` key) | `auth/auth.routes.ts` (express-rate-limit) | login limit exceeded |
| `USERNAME_ALREADY_EXISTS` | 409 | "Username \"x\" is already in use" | `users/users.service.ts` | duplicate username |
| `SELF_DEACTIVATION_NOT_ALLOWED` | 409 | "You cannot deactivate your own account" | `users/users.service.ts` | self `isActive:false` |
| `SELF_DEMOTION_NOT_ALLOWED` | 409 | "You cannot change your own role away from Owner" | `users/users.service.ts` | self role ≠ owner |
| `LAST_ACTIVE_OWNER` | 409 | "This change would leave the system with no active Owner account" | `users/users.service.ts` | last active owner deactivated/demoted |
| `VISIT_TERMINAL` | 409 | "Visit is already X and cannot be changed further" | `visits/visits.service.ts` | any transition from COMPLETED/CANCELLED |
| `INVALID_VISIT_STATE` | 409 | "<action> can only … while the visit is X (currently Y)" | nursing, consultation, laboratory, pharmacy, billing services | module precondition on visit status |
| `CONSULTATION_ALREADY_OPEN` | 409 | "This visit already has an open consultation — complete it before opening another" | `consultation/consultation.service.ts` | second open consultation |
| `CONSULTATION_COMPLETED` | 409 | "This consultation has already been completed" | `consultation/consultation.service.ts` | write to completed consultation |
| `LAB_ORDER_NOT_REQUESTED` | 409 | "Laboratory order is already COMPLETED" | `laboratory/laboratory.service.ts` | start/results/complete on a closed order |
| `ITEM_NOT_IN_ORDER` | 400 | "Item X does not belong to laboratory order Y" | `laboratory/laboratory.service.ts` | foreign result item |
| `INCOMPLETE_RESULTS` | 409 | "Cannot complete: missing results for …" | `laboratory/laboratory.service.ts` | outstanding items without results |
| `ITEM_NOT_IN_PRESCRIPTION` | 400 | "Item X does not belong to prescription Y" | `pharmacy/pharmacy.service.ts` | foreign dispense item |
| `ITEM_ALREADY_TERMINAL` | 409 | "Item X is already S and cannot be dispensed further / marked unavailable" | `pharmacy/pharmacy.service.ts` | dispensing a finished item |
| `EXCEEDS_PRESCRIBED_QUANTITY` | 400 | "Dispensing N would exceed the prescribed quantity …" | `pharmacy/pharmacy.service.ts` | over-dispense |
| `INSUFFICIENT_STOCK` | 409 | "Insufficient stock to dispense N of item X" | `pharmacy/pharmacy.service.ts` | stock too low, or unknown `inventoryItemId` |
| `INCOMPLETE_DISPENSING` | 409 | "Cannot complete: still pending for …" | `pharmacy/pharmacy.service.ts` | any PENDING item on the visit |
| `INVENTORY_ITEM_ALREADY_EXISTS` | 409 | "An inventory item named \"x\" already exists" | `inventory/inventory.service.ts` | duplicate normalized name |
| `INVOICE_ALREADY_EXISTS` | 409 | "This visit already has an invoice" | `billing/billing.service.ts` | second invoice for a visit |
| `INVOICE_NOT_OPEN` | 409 | "Invoice is already PAID" | `billing/billing.service.ts` | items/payment/complete on a PAID invoice |
| `OVERPAYMENT` | 400 | "Payment of X exceeds the remaining balance of Y" | `billing/billing.service.ts` | amount > balance |
| `INVOICE_NOT_PAID` | 409 | "Cannot complete: remaining balance is X" | `billing/billing.service.ts` | complete with balance ≠ 0 |
| `RECEIPT_NOT_AVAILABLE_UNTIL_PAID` | 409 | "Receipts are only available once the invoice is fully paid (currently OPEN)" | `receipts/receipts.service.ts` | receipt for OPEN invoice |
| `INVALID_INVENTORY_ITEM` | 400 | "Inventory item X does not exist" | `purchases/purchases.service.ts` | purchase line with unknown item |
| `PURCHASE_ALREADY_RECEIVED` | 409 | "Purchase is already RECEIVED" | `purchases/purchases.service.ts` | second receive |
| `PATIENT_PHONE_ALREADY_EXISTS` | 409 | "This phone number already belongs to <fullName> (<patientCode>)" + `details: { patientId, patientCode, fullName }` | `patients/patients.service.ts` | POST, or a PATCH that changes the phone, with a number (normalized) that another patient — active or inactive — already has |
| `PRICE_LIST_ITEM_ALREADY_EXISTS` | 409 | "A price list item named \"x\" already exists" | `price-list/price-list.service.ts` | duplicate normalized name on create, or rename onto another item's name |
| `PRICE_LIST_ITEM_INACTIVE` | 409 | "This price list item is inactive and can't be linked" | `charge-links/charge-links.service.ts` | `PUT /charge-links` naming an inactive price-list item |
| `INTERNAL_ERROR` | 500 | "Something went wrong. Please try again." (no `details` key) | `middleware/errorHandler.ts` | any non-AppError, **including malformed JSON bodies** |

---

## 7. Frontend-relevant backend behaviour

### 7.1 Pagination
- **Only `GET /audit-logs`** is paginated: `limit` (1–100, default 20) + `offset` (default 0); `total`, `limit`, `offset` are returned **inside `data`**, not `meta`.
- `GET /patients` has `limit` only (1–100, default 20) — no offset, no total.
- Everything else returns the full list: users, suppliers, purchases (with items), price list items, inventory items, lab queue, pharmacy queue, billing work list, today's visits, and the visit-scoped/patient-scoped lists (`/visits/:id/consultations|lab-orders|prescriptions`, `/patients/:id/visits`, `/patients/:id/history`).

### 7.2 Validation error details
- `details` = `Record<string, string[]>` keyed by field (nested/array paths are keyed by their **top-level** field, e.g. `items`).
- Refines **without** a `path` (Users PATCH "at least one of…", Suppliers and Price List PATCH "at least one field") produce `details: {}` — the message is dropped (Zod puts it in `formErrors`, which `validate.ts` does not return). From code reading; not run.
- Refines **with** a path: Patients create (`dateOfBirth`), Reports (`dateFrom`).

### 7.3 Dates and times
- `timestamptz` columns → ISO-8601 UTC strings with milliseconds and `Z` (verified).
- **`DATE` columns are returned as plain `"YYYY-MM-DD"` strings** — `Patient.dateOfBirth` and `PurchaseDetail.purchaseDate` come back exactly as sent (e.g. `"1990-05-14"`), independent of server timezone. **Fixed 2026-09-27** (the commit titled `fix(db): return DATE columns as plain YYYY-MM-DD strings`): `server/src/config/db.ts` registers a `pg` type parser that passes `DATE` values through as strings; covered by round-trip tests in `tests/patients.test.ts` and `tests/purchases.test.ts`.
  - *Before the fix* (verified): node-postgres turned a `DATE` into a JS `Date` at local midnight, serialized in UTC — with the server/DB in `Africa/Nairobi` (UTC+3), `1990-05-14` was returned as `"1990-05-13T21:00:00.000Z"` (and `2026-01-01` as `"2025-12-31T21:00:00.000Z"`, the previous year).
  - **Historical audit-log snapshots are not corrected:** `beforeValue`/`afterValue` JSON written before the fix (e.g. `patient.create`, `purchase.create`) still holds the shifted timestamp form. Entries written after the fix hold `"YYYY-MM-DD"`.
- Date inputs: `dateOfBirth`, `purchaseDate`, report `dateFrom`/`dateTo` are `"YYYY-MM-DD"`; audit-log `dateFrom`/`dateTo` accept any parseable date (bare date = UTC midnight).
- "Today" everywhere (dashboard, `/visits/today`, report defaults) = PostgreSQL `CURRENT_DATE` in the database's timezone.

### 7.4 IDs
- All entity ids are UUID strings (`gen_random_uuid()`). Path params are checked against a UUID regex (any version) before any DB call.
- Human-facing codes: `patientCode` `WU-000123` (sequence, never reused); `receiptNumber` `RCPT-` + first 8 hex chars of the invoice id, uppercased (derived, not stored).
- `AuditLogEntry.entityId` is a free string ≤64 — a UUID for most entries, the attempted **username** for `login.failed`.

### 7.5 Money and decimals
- Stored as `numeric(10,2)` (max 99 999 999.99). API outputs for billing, receipts, dashboard and reports are **JSON numbers rounded to 2 dp**.
- Inputs are JSON numbers; values with more than 2 decimals are silently rounded by PostgreSQL — except Price List `price`, which rejects them with `VALIDATION_ERROR`. `PriceListItem.price` is returned as a JSON number. `RecordPaymentSchema` allows `amount` up to 100 000 000, above the column maximum.
- Vitals `temperatureCelsius`, `weightKg`, `heightCm` are returned as **strings** (`"37.5"`) or `null` — not numbers.
- Quantities (`quantity`, `quantityOnHand`, `quantityPrescribed`, `quantityDispensed`) are integers; counts are numbers.

### 7.6 Nullable fields that forms must handle
- **Patient:** `dateOfBirth`, `approximateAge`, `phone`, `address`, `emergencyContactName`, `emergencyContactPhone`, `notes`.
- **Visit:** `completedAt`, `cancelledAt`, `cancelReason`. **QueueEvent:** `fromStatus`, `reason`.
- **VitalSigns:** every measurement and `notes`. **NursingAssessment:** `chiefComplaint`, `assessmentNotes`.
- **Consultation:** `notes`, `completedAt`. **Lab item:** `result`, `resultEnteredBy`, `resultEnteredAt`.
- **Prescription item:** `strength`, `dosage`, `frequency`, `duration`, `quantityPrescribed`, `quantityDispensed`, `inventoryItemId` (also redacted to null for most roles), `dispensedBy`, `dispensedAt`.
- **Billing work:** `invoice` (null until created). **Supplier:** `contactPerson`, `phone`, `email`, `address`. **Purchase:** `referenceNumber`, `notes`, `receivedBy`, `receivedAt`.
- **AuditLogEntry:** `user`, `entityId`, `beforeValue`, `afterValue`, `ipAddress`. **Reports:** echoed filters (`status`, `supplierId`) are null when absent.
- **Clearing a field is impossible via PATCH:** Patients and Suppliers update schemas accept only strings (no `null`). Optional text fields can be set to `""`, but supplier `email: ""` fails email validation, so an email can never be removed. A patient's `dateOfBirth` (`""` is not a valid date) and `approximateAge` (number only) can likewise be changed but never removed. A patient `phone: ""` is stored as `""` — so `phone` may be `""` as well as `null` — and never conflicts with another patient's phone.

### 7.7 Status values / enums

| Enum | Values |
|---|---|
| `Role` | `owner`, `reception`, `nurse`, `doctor`, `lab_tech`, `pharmacy` |
| `VisitStatus` | 13 values, section 3.1 |
| Patient `gender` | `male`, `female`, `other` |
| Patient `status` | `active`, `inactive` |
| Lab order `status` | `REQUESTED`, `COMPLETED` |
| Prescription item `status` | `PENDING`, `PARTIALLY_DISPENSED`, `DISPENSED`, `UNAVAILABLE` |
| Invoice `status` | `OPEN`, `PAID` |
| Payment `method` | `cash`, `bank_transfer`, `other` |
| Purchase `status` | `PENDING`, `RECEIVED` |
| Financial report `groupBy` | `day`, `month` |
| Health `status` | `ok`, `degraded` |

### 7.8 Responses that differ from the normal envelope
- `GET /api/v1/dashboard` — `data` is the snapshot itself, not `{ dashboard: … }`.
- `GET /api/v1/audit-logs` — pagination fields inside `data`; `meta` still `null`.
- `GET /api/v1/receipts/invoices/:invoiceId/print` — `text/html` on success.
- `GET /health` — 503 carries `data` with `error: null`.
- `POST /api/v1/auth/login` 429 — produced by express-rate-limit (envelope-shaped, no `details`).
- Unknown route 404 and every 500 — envelope without `details`.
- Response keys that differ from the entity name: `POST /consultations/:id/lab-orders` → `labOrder`; `GET /laboratory/orders` and `GET /visits/:id/lab-orders` → `orders`; `GET /billing/invoices` → `work`; Price List routes → `items` / `item`; Charge links → `links` / `link`; nursing assessment and completion routes return a `visitStatus` string alongside the entity.

### 7.9 Read endpoints the frontend may expect but which do not exist
- No cross-patient visit search or date-ranged visit list. Visits are reachable through `/visits/today` (created today only), `GET /visits/:id`, and a patient's history (`GET /patients/:id/visits`) — so a visit created yesterday and still in progress does not appear in any **queue**, though it does appear in its patient's history.
- *Added 2026-09-28 (previously missing):* a visit-detail page can now read the nursing assessment (`GET /visits/:id/nursing-assessment`), consultations with diagnoses (`/visits/:id/consultations`), lab orders (`/visits/:id/lab-orders`), prescriptions (`/visits/:id/prescriptions`) and invoice (`/visits/:id/invoice`), and a patient-history page can list a patient's visits (`GET /patients/:id/visits`).
