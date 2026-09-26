import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, getUserIdByUsername, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function createPatientAndVisit(status: string, createdAt: Date, uniquePart: string) {
  const receptionId = await getUserIdByUsername("test.reception");
  const patientCode = `WU${Date.now().toString(36).slice(-6)}${uniquePart}`.slice(0, 20);
  const patientRes = await pool.query(
    `INSERT INTO patients (patient_code, full_name, gender, approximate_age, created_by, created_at)
     VALUES ($1, $2, 'female', 28, $3, $4) RETURNING id`,
    [patientCode, `Reports Test Patient ${uniquePart}`, receptionId, createdAt]
  );
  const patientId = patientRes.rows[0].id;
  const visitRes = await pool.query(
    `INSERT INTO visits (patient_id, status, created_by, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [patientId, status, receptionId, createdAt]
  );
  return { patientId, visitId: visitRes.rows[0].id, patientCode };
}

async function createInvoiceFixture(opts: { discount?: number; createdAt?: Date } = {}) {
  const receptionId = await getUserIdByUsername("test.reception");
  const { visitId, patientCode } = await createPatientAndVisit(
    "WAITING_FOR_BILLING",
    opts.createdAt ?? new Date(),
    Math.random().toString(36).slice(2, 6)
  );
  const invoiceRes = await pool.query(
    `INSERT INTO invoices (visit_id, cashier_id, discount, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [visitId, receptionId, opts.discount ?? 0, opts.createdAt ?? new Date()]
  );
  return { invoiceId: invoiceRes.rows[0].id, visitId, patientCode };
}

async function addItem(invoiceId: string, description: string, quantity: number, unitPrice: number) {
  await pool.query(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
    [invoiceId, description, quantity, unitPrice]
  );
}

async function addPayment(invoiceId: string, amount: number, method: string, paidAt?: Date) {
  const receptionId = await getUserIdByUsername("test.reception");
  await pool.query(
    `INSERT INTO payments (invoice_id, amount, method, recorded_by, paid_at) VALUES ($1, $2, $3, $4, $5)`,
    [invoiceId, amount, method, receptionId, paidAt ?? new Date()]
  );
}

async function markInvoicePaid(invoiceId: string) {
  await pool.query(`UPDATE invoices SET status = 'PAID' WHERE id = $1`, [invoiceId]);
}

async function createSupplier() {
  const res = await pool.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [
    `Reports Test Supplier ${Date.now()}-${Math.random()}`,
  ]);
  return res.rows[0].id as string;
}

async function createInventoryItem(quantityOnHand = 0) {
  const res = await pool.query(
    `INSERT INTO pharmacy_inventory_items (name, unit, quantity_on_hand) VALUES ($1, 'unit', $2) RETURNING id`,
    [`Reports Test Item ${Date.now()}-${Math.random()}`, quantityOnHand]
  );
  return res.rows[0].id as string;
}

async function createPurchase(opts: {
  supplierId: string;
  purchaseDate: Date;
  status: "PENDING" | "RECEIVED";
  items: Array<{ inventoryItemId: string; quantity: number; unitCost: number }>;
}) {
  const ownerId = await getUserIdByUsername("test.owner");
  const purchaseRes = await pool.query(
    `INSERT INTO purchases (supplier_id, purchase_date, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.supplierId, isoDate(opts.purchaseDate), opts.status, ownerId]
  );
  const purchaseId = purchaseRes.rows[0].id;
  for (const item of opts.items) {
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, inventory_item_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)`,
      [purchaseId, item.inventoryItemId, item.quantity, item.unitCost]
    );
  }
  return purchaseId as string;
}

async function createDispensedPrescriptionItem(opts: {
  status: "PENDING" | "PARTIALLY_DISPENSED" | "DISPENSED" | "UNAVAILABLE";
  quantityDispensed?: number;
  dispensedAt?: Date;
}) {
  const doctorId = await getUserIdByUsername("test.doctor");
  const { visitId } = await createPatientAndVisit("WITH_DOCTOR", new Date(), Math.random().toString(36).slice(2, 6));
  const consultRes = await pool.query(`INSERT INTO consultations (visit_id, doctor_id) VALUES ($1, $2) RETURNING id`, [
    visitId,
    doctorId,
  ]);
  const consultationId = consultRes.rows[0].id;
  const prescriptionRes = await pool.query(
    `INSERT INTO prescriptions (visit_id, consultation_id, doctor_id) VALUES ($1, $2, $3) RETURNING id`,
    [visitId, consultationId, doctorId]
  );
  const prescriptionId = prescriptionRes.rows[0].id;
  const itemRes = await pool.query(
    `INSERT INTO prescription_items (prescription_id, medicine_name, quantity_prescribed, status, quantity_dispensed, dispensed_at)
     VALUES ($1, 'Reports Test Medicine', 10, $2, $3, $4) RETURNING id`,
    [prescriptionId, opts.status, opts.quantityDispensed ?? null, opts.dispensedAt ?? null]
  );
  return itemRes.rows[0].id as string;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access to every report", async () => {
    expect((await request(app).get("/api/v1/reports/visits")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports/financial")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports/purchasing")).status).toBe(401);
    expect((await request(app).get("/api/v1/reports/pharmacy-dispensing")).status).toBe(401);
  });

  it("rejects every non-Owner role from every report", async () => {
    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get("/api/v1/reports/visits")).status).toBe(403);
      expect((await agent.get("/api/v1/reports/financial")).status).toBe(403);
      expect((await agent.get("/api/v1/reports/purchasing")).status).toBe(403);
      expect((await agent.get("/api/v1/reports/pharmacy-dispensing")).status).toBe(403);
    }
  });

  it("allows Owner access to every report", async () => {
    const owner = await loginAs("test.owner");
    expect((await owner.get("/api/v1/reports/visits")).status).toBe(200);
    expect((await owner.get("/api/v1/reports/financial")).status).toBe(200);
    expect((await owner.get("/api/v1/reports/purchasing")).status).toBe(200);
    expect((await owner.get("/api/v1/reports/pharmacy-dispensing")).status).toBe(200);
  });
});

describe("Date range resolution", () => {
  it("defaults to the last 30 days (inclusive of today) when no dates are given", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits");
    expect(res.status).toBe(200);
    expect(res.body.data.report.dateTo).toBe(isoDate(new Date()));
    expect(res.body.data.report.dateFrom).toBe(isoDate(daysAgo(29)));
  });

  it("uses explicit dateFrom/dateTo when provided", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.dateFrom).toBe("2026-01-01");
    expect(res.body.data.report.dateTo).toBe("2026-01-31");
  });

  it("rejects a malformed date", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("rejects dateFrom after dateTo", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: "2026-02-01", dateTo: "2026-01-01" });
    expect(res.status).toBe(400);
  });

  it("includes a record created at the exact dateTo boundary (inclusive)", async () => {
    const owner = await loginAs("test.owner");
    const boundaryDay = daysAgo(5);
    const lateInDay = new Date(boundaryDay);
    lateInDay.setUTCHours(23, 59, 0, 0);
    await createPatientAndVisit("REGISTERED", lateInDay, "bound1");

    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: isoDate(daysAgo(5)), dateTo: isoDate(daysAgo(5)) });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("excludes a record one day before dateFrom", async () => {
    const owner = await loginAs("test.owner");
    const dayBefore = daysAgo(11);
    dayBefore.setUTCHours(12, 0, 0, 0);
    await createPatientAndVisit("REGISTERED", dayBefore, "excl1");

    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: isoDate(daysAgo(10)), dateTo: isoDate(daysAgo(10)) });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalCount).toBe(0);
  });
});

describe("Visits report", () => {
  it("reports counts by status and by date within range", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(3);
    await createPatientAndVisit("CANCELLED", day, "vis1");
    await createPatientAndVisit("CANCELLED", day, "vis2");
    await createPatientAndVisit("REGISTERED", day, "vis3");

    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: isoDate(day), dateTo: isoDate(day) });
    expect(res.status).toBe(200);
    const cancelled = res.body.data.report.byStatus.find((r: { status: string }) => r.status === "CANCELLED");
    expect(cancelled.count).toBeGreaterThanOrEqual(2);
  });

  it("supports an optional status filter", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(4);
    await createPatientAndVisit("COMPLETED", day, "vis4");

    const res = await owner
      .get("/api/v1/reports/visits")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day), status: "COMPLETED" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.byStatus.every((r: { status: string }) => r.status === "COMPLETED")).toBe(true);
  });

  it("rejects an invalid status value", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits").query({ status: "NOT_A_REAL_STATUS" });
    expect(res.status).toBe(400);
  });

  it("returns empty aggregates for a range with no data", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/visits").query({ dateFrom: "2020-01-01", dateTo: "2020-01-02" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalCount).toBe(0);
    expect(res.body.data.report.byStatus).toHaveLength(0);
  });
});

describe("Financial report", () => {
  it("calculates total revenue, payment count, and method breakdown correctly", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(2);
    const { invoiceId } = await createInvoiceFixture({ createdAt: day });
    await addItem(invoiceId, "Consultation", 1, 300);
    await addPayment(invoiceId, 200, "cash", day);
    await addPayment(invoiceId, 100, "bank_transfer", day);
    await markInvoicePaid(invoiceId);

    const res = await owner.get("/api/v1/reports/financial").query({ dateFrom: isoDate(day), dateTo: isoDate(day) });
    expect(res.status).toBe(200);
    const r = res.body.data.report;
    expect(r.totalRevenue).toBeGreaterThanOrEqual(300);
    expect(r.paymentCount).toBeGreaterThanOrEqual(2);
    const cash = r.byMethod.find((m: { method: string }) => m.method === "cash");
    const bank = r.byMethod.find((m: { method: string }) => m.method === "bank_transfer");
    expect(cash.total).toBeGreaterThanOrEqual(200);
    expect(bank.total).toBeGreaterThanOrEqual(100);
  });

  it("groups by day", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(6);
    const { invoiceId } = await createInvoiceFixture({ createdAt: day });
    await addItem(invoiceId, "X", 1, 50);
    await addPayment(invoiceId, 50, "cash", day);
    await markInvoicePaid(invoiceId);

    const res = await owner
      .get("/api/v1/reports/financial")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day), groupBy: "day" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.byPeriod.some((p: { period: string }) => p.period === isoDate(day))).toBe(true);
  });

  it("groups by month", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(7);
    const { invoiceId } = await createInvoiceFixture({ createdAt: day });
    await addItem(invoiceId, "X", 1, 50);
    await addPayment(invoiceId, 50, "cash", day);
    await markInvoicePaid(invoiceId);

    const res = await owner
      .get("/api/v1/reports/financial")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day), groupBy: "month" });
    expect(res.status).toBe(200);
    const expectedMonth = isoDate(day).slice(0, 7);
    expect(res.body.data.report.byPeriod.some((p: { period: string }) => p.period === expectedMonth)).toBe(true);
  });

  it("rejects an unsupported groupBy value", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/financial").query({ groupBy: "week" });
    expect(res.status).toBe(400);
  });

  it("lists outstanding OPEN invoices with correct subtotal/discount/total/paid/balance, excluding fully paid ones", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(1);
    const { invoiceId: openId } = await createInvoiceFixture({ createdAt: day, discount: 5 });
    await addItem(openId, "Procedure", 1, 200);
    await addPayment(openId, 50, "cash", day);

    const { invoiceId: paidId } = await createInvoiceFixture({ createdAt: day });
    await addItem(paidId, "Consultation", 1, 100);
    await addPayment(paidId, 100, "cash", day);
    await markInvoicePaid(paidId);

    const res = await owner.get("/api/v1/reports/financial").query({ dateFrom: isoDate(day), dateTo: isoDate(day) });
    expect(res.status).toBe(200);
    const outstanding = res.body.data.report.outstandingInvoices;
    const openEntry = outstanding.find((o: { invoiceId: string }) => o.invoiceId === openId);
    expect(openEntry).toBeDefined();
    expect(openEntry.subtotal).toBe(200);
    expect(openEntry.discount).toBe(5);
    expect(openEntry.total).toBe(195);
    expect(openEntry.amountPaid).toBe(50);
    expect(openEntry.balance).toBe(145);
    expect(outstanding.some((o: { invoiceId: string }) => o.invoiceId === paidId)).toBe(false);
  });
});

describe("Purchasing report", () => {
  it("aggregates by status/supplier/date with correct quantity and cost", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(8);
    const supplierId = await createSupplier();
    const itemA = await createInventoryItem();
    const itemB = await createInventoryItem();

    await createPurchase({
      supplierId,
      purchaseDate: day,
      status: "RECEIVED",
      items: [
        { inventoryItemId: itemA, quantity: 100, unitCost: 2 },
        { inventoryItemId: itemB, quantity: 50, unitCost: 3 },
      ],
    });

    const res = await owner
      .get("/api/v1/reports/purchasing")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day), supplierId });
    expect(res.status).toBe(200);
    const r = res.body.data.report;
    expect(r.totalPurchases).toBe(1);
    expect(r.totalQuantity).toBe(150);
    expect(r.totalCost).toBe(350);
    expect(r.bySupplier[0].supplierId).toBe(supplierId);
  });

  it("supports an optional status filter", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(9);
    const supplierId = await createSupplier();
    const itemA = await createInventoryItem();
    await createPurchase({
      supplierId,
      purchaseDate: day,
      status: "PENDING",
      items: [{ inventoryItemId: itemA, quantity: 10, unitCost: 1 }],
    });

    const res = await owner
      .get("/api/v1/reports/purchasing")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day), supplierId, status: "RECEIVED" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalPurchases).toBe(0);
  });

  it("returns empty aggregates for a range with no purchases", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/reports/purchasing").query({ dateFrom: "2020-01-01", dateTo: "2020-01-02" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalPurchases).toBe(0);
  });
});

describe("Pharmacy dispensing report", () => {
  it("aggregates dispensed items by status and date using dispensed_at", async () => {
    const owner = await loginAs("test.owner");
    const day = daysAgo(15);
    await createDispensedPrescriptionItem({ status: "DISPENSED", quantityDispensed: 10, dispensedAt: day });
    await createDispensedPrescriptionItem({ status: "PARTIALLY_DISPENSED", quantityDispensed: 4, dispensedAt: day });

    const res = await owner
      .get("/api/v1/reports/pharmacy-dispensing")
      .query({ dateFrom: isoDate(day), dateTo: isoDate(day) });
    expect(res.status).toBe(200);
    const r = res.body.data.report;
    expect(r.totalItemsDispensed).toBeGreaterThanOrEqual(2);
    expect(r.totalQuantityDispensed).toBeGreaterThanOrEqual(14);
  });

  it("a status filter of PENDING correctly returns zero rows (no dispensed_at exists for that status)", async () => {
    const owner = await loginAs("test.owner");
    await createDispensedPrescriptionItem({ status: "PENDING" });
    const res = await owner.get("/api/v1/reports/pharmacy-dispensing").query({ status: "PENDING" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalItemsDispensed).toBe(0);
  });

  it("returns empty aggregates for a range with no dispensing activity", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner
      .get("/api/v1/reports/pharmacy-dispensing")
      .query({ dateFrom: "2020-01-01", dateTo: "2020-01-02" });
    expect(res.status).toBe(200);
    expect(res.body.data.report.totalItemsDispensed).toBe(0);
  });
});

describe("No mutation from report reads", () => {
  it("repeated report requests never change underlying row counts", async () => {
    const owner = await loginAs("test.owner");
    const tables = ["patients", "visits", "invoices", "payments", "purchases", "prescription_items", "audit_logs"];
    const before = await Promise.all(tables.map((t) => pool.query(`SELECT COUNT(*) FROM ${t}`)));

    await owner.get("/api/v1/reports/visits");
    await owner.get("/api/v1/reports/financial");
    await owner.get("/api/v1/reports/purchasing");
    await owner.get("/api/v1/reports/pharmacy-dispensing");
    await owner.get("/api/v1/reports/visits");

    const after = await Promise.all(tables.map((t) => pool.query(`SELECT COUNT(*) FROM ${t}`)));

    for (let i = 0; i < before.length; i++) {
      expect(after[i].rows[0].count).toBe(before[i].rows[0].count);
    }
  });
});
