import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

async function createVisitWaitingForBilling() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Dashboard Test Patient ${Date.now()}-${Math.random()}`);
  const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = visitRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Fever" });

  const doctor = await loginAs("test.doctor");
  const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  const consultationId = consultRes.body.data.consultation.id as string;
  await doctor.post(`/api/v1/consultations/${consultationId}/complete`);

  return { visitId, reception };
}

async function createInventoryItem(quantityOnHand: number) {
  const owner = await loginAs("test.owner");
  const name = `Dashboard Stock Item ${Date.now()}-${Math.random()}`;
  const res = await owner.post("/api/v1/inventory/items").send({ name, unit: "unit", quantityOnHand });
  return res.body.data.item.id as string;
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects every non-owner role", async () => {
    for (const username of ["test.reception", "test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      const res = await agent.get("/api/v1/dashboard");
      expect(res.status).toBe(403);
    }
  });

  it("owner can access the dashboard", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/dashboard");
    expect(res.status).toBe(200);
  });
});

describe("Response structure", () => {
  it("contains every required field with the correct types, never null where a number is expected", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/dashboard");
    const d = res.body.data;

    expect(typeof d.generatedAt).toBe("string");
    expect(typeof d.patients.registeredToday).toBe("number");
    expect(typeof d.visits.today).toBe("number");
    expect(typeof d.visits.completedToday).toBe("number");
    expect(typeof d.visits.cancelledToday).toBe("number");
    expect(typeof d.visits.byStatus).toBe("object");
    expect(typeof d.billing.revenueToday).toBe("number");
    expect(typeof d.billing.paymentsToday).toBe("number");
    expect(typeof d.billing.openInvoiceCount).toBe("number");
    expect(typeof d.billing.totalOutstandingBalance).toBe("number");
    expect(typeof d.inventory.totalItems).toBe("number");
    expect(typeof d.inventory.outOfStockCount).toBe("number");
    expect(typeof d.staff.activeByRole).toBe("object");
    expect(typeof d.staff.totalActive).toBe("number");
  });

  it("visits.byStatus includes WAITING_FOR_BILLING and every other non-terminal status, even at zero", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/dashboard");
    const byStatus = res.body.data.visits.byStatus;

    for (const status of [
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
    ]) {
      expect(byStatus).toHaveProperty(status);
      expect(typeof byStatus[status]).toBe("number");
    }
    expect(byStatus).not.toHaveProperty("COMPLETED");
    expect(byStatus).not.toHaveProperty("CANCELLED");
  });

  it("staff.activeByRole includes every role, even at zero", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/dashboard");
    const byRole = res.body.data.staff.activeByRole;
    for (const role of ["owner", "reception", "nurse", "doctor", "lab_tech", "pharmacy"]) {
      expect(byRole).toHaveProperty(role);
      expect(typeof byRole[role]).toBe("number");
    }
  });
});

describe("Patients and visits counts - verified through real APIs", () => {
  it("registeredToday increases after registering a patient via the real API", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeCount = before.body.data.patients.registeredToday;

    const reception = await loginAs("test.reception");
    await reception
      .post("/api/v1/patients")
      .send({ fullName: `Dashboard Count Patient ${Date.now()}`, gender: "female", approximateAge: 30 });

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.patients.registeredToday).toBe(beforeCount + 1);
  });

  it("visits.today increases after creating a visit, and byStatus reflects its current status", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeToday = before.body.data.visits.today;
    const beforeWaitingForNurse = before.body.data.visits.byStatus.WAITING_FOR_NURSE;

    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`Visit Count Test ${Date.now()}-${Math.random()}`);
    const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
    const visitId = visitRes.body.data.visit.id;
    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.visits.today).toBe(beforeToday + 1);
    expect(after.body.data.visits.byStatus.WAITING_FOR_NURSE).toBe(beforeWaitingForNurse + 1);
  });

  it("completedToday and cancelledToday reflect real terminal transitions", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeCompleted = before.body.data.visits.completedToday;
    const beforeCancelled = before.body.data.visits.cancelledToday;

    const reception = await loginAs("test.reception");
    const patientA = await createTestPatient(`Cancel Test ${Date.now()}-${Math.random()}`);
    const visitA = await reception.post("/api/v1/visits").send({ patientId: patientA.id });
    await reception
      .post(`/api/v1/visits/${visitA.body.data.visit.id}/transition`)
      .send({ toStatus: "CANCELLED", reason: "dashboard test" });

    const { visitId } = await createVisitWaitingForBilling();
    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invRes.body.data.invoice.id;
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.visits.completedToday).toBe(beforeCompleted + 1);
    expect(after.body.data.visits.cancelledToday).toBe(beforeCancelled + 1);
  });
});

describe("Billing metrics - verified with a partially-paid invoice", () => {
  it("revenueToday and paymentsToday increase after recording a payment", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeRevenue = before.body.data.billing.revenueToday;
    const beforePayments = before.body.data.billing.paymentsToday;

    const { visitId, reception } = await createVisitWaitingForBilling();
    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invRes.body.data.invoice.id;
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [{ description: "Consultation", quantity: 1, unitPrice: 200 }],
    });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 80, method: "cash" });

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.billing.revenueToday).toBeCloseTo(beforeRevenue + 80, 2);
    expect(after.body.data.billing.paymentsToday).toBe(beforePayments + 1);
  });

  it("openInvoiceCount and totalOutstandingBalance correctly reflect a partially-paid open invoice", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeOpen = before.body.data.billing.openInvoiceCount;
    const beforeOutstanding = before.body.data.billing.totalOutstandingBalance;

    const { visitId, reception } = await createVisitWaitingForBilling();
    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invRes.body.data.invoice.id;
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [{ description: "Procedure", quantity: 2, unitPrice: 150 }],
    });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 120, method: "cash" });

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.billing.openInvoiceCount).toBe(beforeOpen + 1);
    expect(after.body.data.billing.totalOutstandingBalance).toBeCloseTo(beforeOutstanding + 180, 2);
  });

  it("totalOutstandingBalance excludes invoices that have already been fully paid (status PAID)", async () => {
    const owner = await loginAs("test.owner");
    const { visitId, reception } = await createVisitWaitingForBilling();
    const invRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invRes.body.data.invoice.id;
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [{ description: "Consultation", quantity: 1, unitPrice: 100 }],
    });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "cash" });

    const before = await owner.get("/api/v1/dashboard");
    const beforeOutstanding = before.body.data.billing.totalOutstandingBalance;
    const beforeOpen = before.body.data.billing.openInvoiceCount;

    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.billing.totalOutstandingBalance).toBeCloseTo(beforeOutstanding, 2);
    expect(after.body.data.billing.openInvoiceCount).toBe(beforeOpen - 1);
  });
});

describe("Inventory metrics - verified through the real Inventory API", () => {
  it("totalItems increases after creating a stock item", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeTotal = before.body.data.inventory.totalItems;

    await createInventoryItem(50);

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.inventory.totalItems).toBe(beforeTotal + 1);
  });

  it("outOfStockCount reflects an item created with zero quantity, and not one with positive stock", async () => {
    const owner = await loginAs("test.owner");
    const before = await owner.get("/api/v1/dashboard");
    const beforeOutOfStock = before.body.data.inventory.outOfStockCount;

    await createInventoryItem(0);
    await createInventoryItem(10);

    const after = await owner.get("/api/v1/dashboard");
    expect(after.body.data.inventory.outOfStockCount).toBe(beforeOutOfStock + 1);
  });
});

describe("Staff metrics", () => {
  it("activeByRole and totalActive reflect the seeded active users, order-independent of other tests", async () => {
    const owner = await loginAs("test.owner");
    const res = await owner.get("/api/v1/dashboard");

    const countRes = await pool.query("SELECT COUNT(*) FROM users WHERE is_active = true");
    expect(res.body.data.staff.totalActive).toBe(Number(countRes.rows[0].count));

    const byRoleRes = await pool.query(
      `SELECT r.name, COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = true GROUP BY r.name`
    );
    for (const row of byRoleRes.rows) {
      expect(res.body.data.staff.activeByRole[row.name]).toBe(Number(row.count));
    }
  });
});
