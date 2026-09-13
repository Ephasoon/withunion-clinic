import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";
import { addInvoiceItems } from "../src/modules/billing/billing.service";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

/**
 * Builds a visit all the way to WAITING_FOR_BILLING via the real
 * Nursing + Consultation flow (no lab order, no prescription -- the
 * doctor completes straight to billing), same end-to-end pattern
 * used by every prior module's test suite.
 */
async function createVisitWaitingForBilling() {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Billing Test Patient ${Date.now()}-${Math.random()}`);
  const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = visitRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Routine checkup" });

  const doctor = await loginAs("test.doctor");
  const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  const consultationId = consultRes.body.data.consultation.id as string;
  await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // no lab/prescription -> WAITING_FOR_BILLING

  return { reception, doctor, visitId };
}

async function createInvoiceFor(visitId: string) {
  const reception = await loginAs("test.reception");
  const res = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
  return { reception, invoiceId: res.body.data.invoice.id as string, res };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("Reception can create an invoice", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { res } = await createInvoiceFor(visitId);
    expect(res.status).toBe(201);
  });

  it("non-Reception cannot create an invoice", async () => {
    const { visitId, doctor } = await createVisitWaitingForBilling();
    const res = await doctor.post(`/api/v1/billing/visits/${visitId}/invoice`);
    expect(res.status).toBe(403);
  });

  it("non-Reception cannot add items, record payments, or complete", async () => {
    const { visitId, doctor } = await createVisitWaitingForBilling();
    const { invoiceId } = await createInvoiceFor(visitId);

    const itemsRes = await doctor
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "X", quantity: 1, unitPrice: 10 }] });
    expect(itemsRes.status).toBe(403);

    const paymentRes = await doctor.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 10, method: "cash" });
    expect(paymentRes.status).toBe(403);

    const completeRes = await doctor.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(completeRes.status).toBe(403);
  });

  it("any authenticated role can read invoice detail", async () => {
    const { visitId, doctor } = await createVisitWaitingForBilling();
    const { invoiceId } = await createInvoiceFor(visitId);
    const res = await doctor.get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
  });

  it("rejects an unauthenticated request", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const res = await request(app).post(`/api/v1/billing/visits/${visitId}/invoice`);
    expect(res.status).toBe(401);
  });

  it("non-Reception cannot list billing work", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get("/api/v1/billing/invoices");
    expect(res.status).toBe(403);
  });
});

describe("Invoice creation", () => {
  it("creates an invoice for a WAITING_FOR_BILLING visit with cashier attribution", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { res } = await createInvoiceFor(visitId);
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.visitId).toBe(visitId);
    expect(res.body.data.invoice.status).toBe("OPEN");
    expect(res.body.data.invoice.cashierId).toBeTruthy();
  });

  it("rejects creation for a visit in the wrong status", async () => {
    const reception = await loginAs("test.reception");
    const patient = await createTestPatient(`Wrong State Billing ${Date.now()}`);
    const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
    const visitId = visitRes.body.data.visit.id; // still REGISTERED

    const res = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });

  it("rejects a duplicate invoice for the same visit", async () => {
    const { visitId, reception } = await createVisitWaitingForBilling();
    await createInvoiceFor(visitId);

    const res = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_ALREADY_EXISTS");
  });
});

describe("Invoice items", () => {
  it("adds a single item", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "Consultation fee", quantity: 1, unitPrice: 200 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.items).toHaveLength(1);
    expect(res.body.data.invoice.subtotal).toBe(200);
  });

  it("adds multiple items in one batch", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [
        { description: "Consultation fee", quantity: 1, unitPrice: 200 },
        { description: "Bandage", quantity: 3, unitPrice: 15 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.subtotal).toBe(245);
  });

  it("rejects an empty description", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "", quantity: 1, unitPrice: 10 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a zero/negative quantity", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "X", quantity: 0, unitPrice: 10 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a negative price", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "X", quantity: 1, unitPrice: -5 }] });
    expect(res.status).toBe(400);
  });

  it("rejects adding items to a PAID invoice", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);

    const res = await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "Too late", quantity: 1, unitPrice: 10 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_OPEN");
  });

  it("batch atomicity: a genuine DB-level failure mid-batch rolls back the whole batch", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);

    // Calling the service directly (bypassing Zod's .max(10_000_000),
    // which is far tighter than the DB column) to reach a genuine
    // Postgres numeric(10,2) overflow: that type allows at most 10
    // total significant digits (8 before the decimal + 2 after), so
    // 123456789.99 (9 + 2 = 11 digits) is rejected by the database
    // itself, not by application-level validation. The first item in
    // the batch is individually valid and would succeed in isolation.
    await expect(
      addInvoiceItems(invoiceId, {
        items: [
          { description: "Valid first item", quantity: 1, unitPrice: 50 },
          { description: "Overflows numeric(10,2)", quantity: 1, unitPrice: 123456789.99 },
        ],
      })
    ).rejects.toThrow();

    // Prove the first (individually valid) item did NOT persist either
    // -- true whole-batch rollback, not just "the bad row was skipped".
    const detail = await reception.get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(detail.body.data.invoice.items).toHaveLength(0);
  });
});

describe("Financial calculations", () => {
  it("derives subtotal, discount, total, amountPaid, and balance correctly", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [{ description: "Consultation", quantity: 1, unitPrice: 1000 }],
    });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 400, method: "cash" });

    const res = await reception.get(`/api/v1/billing/invoices/${invoiceId}`);
    const invoice = res.body.data.invoice;
    expect(invoice.subtotal).toBe(1000);
    expect(invoice.discount).toBe(0);
    expect(invoice.total).toBe(1000);
    expect(invoice.amountPaid).toBe(400);
    expect(invoice.balance).toBe(600);
  });
});

describe("Discount", () => {
  it("a newly created invoice always has a zero discount", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { res } = await createInvoiceFor(visitId);
    expect(res.body.data.invoice.discount).toBe(0);
  });

  it("an unexpected discount field on creation has no effect (not accepted by the endpoint)", async () => {
    const { visitId, reception } = await createVisitWaitingForBilling();
    const res = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`).send({ discount: 50 });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.discount).toBe(0);
  });
});

describe("Payments", () => {
  it("accepts a cash payment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "cash" });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.balance).toBe(0);
  });

  it("accepts a bank_transfer payment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "bank_transfer" });
    expect(res.status).toBe(201);
  });

  it("accepts an other payment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "other" });
    expect(res.status).toBe(201);
  });

  it("supports multiple partial payments summing correctly", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 1000 }] });

    const first = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 400, method: "cash" });
    expect(first.body.data.invoice.balance).toBe(600);

    const second = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 600, method: "cash" });
    expect(second.body.data.invoice.balance).toBe(0);
    expect(second.body.data.invoice.amountPaid).toBe(1000);
  });

  it("rejects a zero payment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 0, method: "cash" });
    expect(res.status).toBe(400);
  });

  it("rejects a negative payment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: -50, method: "cash" });
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported payment method", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 50, method: "crypto" });
    expect(res.status).toBe(400);
  });

  it("rejects overpayment", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 150, method: "cash" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OVERPAYMENT");
  });

  it("rejects payment after the invoice is PAID", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 10, method: "cash" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_OPEN");
  });
});

describe("Completion", () => {
  it("rejects completion with an unpaid balance", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_PAID");
  });

  it("succeeds when balance is exactly zero", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({ items: [{ description: "X", quantity: 1, unitPrice: 100 }] });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "cash" });

    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe("PAID");
    expect(res.body.data.visitStatus).toBe("COMPLETED");
  });

  it("succeeds for a zero-item invoice", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe("PAID");
  });

  it("prevents duplicate completion", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);

    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_NOT_OPEN");
  });

  it("visit reaches COMPLETED via the real transition endpoint", async () => {
    const { visitId, reception } = await createVisitWaitingForBilling();
    const { invoiceId } = await createInvoiceFor(visitId);
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);

    const visitDetail = await reception.get(`/api/v1/visits/${visitId}`);
    expect(visitDetail.body.data.visit.status).toBe("COMPLETED");
    const lastEvent = visitDetail.body.data.history[visitDetail.body.data.history.length - 1];
    expect(lastEvent.fromStatus).toBe("WAITING_FOR_BILLING");
    expect(lastEvent.toStatus).toBe("COMPLETED");
  });
});

describe("Concurrency — addInvoiceItems() vs completeBilling()", () => {
  it("a genuine concurrent race between adding an item and completing cannot produce a PAID invoice with a positive balance", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);

    // Bring the invoice to exactly balance = 0 first.
    await reception
      .post(`/api/v1/billing/invoices/${invoiceId}/items`)
      .send({ items: [{ description: "Consultation", quantity: 1, unitPrice: 100 }] });
    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 100, method: "cash" });

    const detailBefore = await reception.get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(detailBefore.body.data.invoice.balance).toBe(0);

    // Fire a genuinely concurrent add-item and complete request against
    // the same invoice. Both hit the real running app / real Postgres;
    // nothing here is mocked. Whichever transaction acquires the
    // invoices-row FOR UPDATE lock first fully resolves before the
    // other proceeds against fresh data — so exactly one of these two
    // outcomes must hold, and the forbidden third outcome (PAID with a
    // positive balance) must never occur.
    const [itemRes, completeRes] = await Promise.all([
      reception
        .post(`/api/v1/billing/invoices/${invoiceId}/items`)
        .send({ items: [{ description: "Late-added procedure", quantity: 1, unitPrice: 75 }] }),
      reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`),
    ]);

    const finalDetail = await reception.get(`/api/v1/billing/invoices/${invoiceId}`);
    const invoice = finalDetail.body.data.invoice;

    // The invariant that must never be violated, regardless of which
    // request happened to win the race:
    if (invoice.status === "PAID") {
      expect(invoice.balance).toBe(0);
      // The late item cannot be present on a PAID invoice with zero
      // balance unless it was already paid for too — since it wasn't,
      // its addition must have been the one that lost the race.
      expect(itemRes.status).not.toBe(201);
      expect(completeRes.status).toBe(200);
    } else {
      // The item-add won the race: invoice correctly stays OPEN with
      // a positive balance, and completion correctly failed.
      expect(invoice.status).toBe("OPEN");
      expect(invoice.balance).toBeGreaterThan(0);
      expect(itemRes.status).toBe(201);
      expect(completeRes.status).not.toBe(200);
    }

    // Either way, exactly one request succeeded and one failed — this
    // is what proves genuine serialization rather than both silently
    // "succeeding" against stale data.
    const succeeded = [itemRes.status === 201, completeRes.status === 200].filter(Boolean);
    expect(succeeded).toHaveLength(1);
  });
});

describe("Transaction atomicity - billing completion", () => {
  it("a genuine transitionVisitWithClient failure during completion rolls back the entire transaction — invoice, visit, and queue_events together", async () => {
    const { visitId } = await createVisitWaitingForBilling();
    const { reception, invoiceId } = await createInvoiceFor(visitId);

    // Cancelling first is a real, legitimate operation (its own
    // correct transition, with its own queue_events row) that leaves
    // the visit in a TERMINAL_STATUSES state. The subsequent complete
    // attempt then genuinely fails inside transitionVisitWithClient's
    // TERMINAL_STATUSES guard — not a mock, not a simulated error.
    await reception
      .post(`/api/v1/visits/${visitId}/transition`)
      .send({ toStatus: "CANCELLED", reason: "test-induced conflict for atomicity check" });

    const queueEventsBefore = await pool.query("SELECT count(*) FROM queue_events WHERE visit_id = $1", [visitId]);

    const res = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(res.status).not.toBe(200);

    // Since completeBilling() now runs the invoice UPDATE and the
    // visit transition in ONE withTransaction() call, a failure in
    // either half means NEITHER half ever committed — there is no
    // compensating write reverting the invoice; it was simply never
    // persisted. This is genuine PostgreSQL rollback, not compensation.
    const invoiceRow = await pool.query("SELECT status FROM invoices WHERE id = $1", [invoiceId]);
    expect(invoiceRow.rows[0].status).toBe("OPEN");

    // The queue_events insert (part of the same failed transaction)
    // must not have persisted either — proving the whole transaction
    // rolled back together, not just the invoice row in isolation.
    const queueEventsAfter = await pool.query("SELECT count(*) FROM queue_events WHERE visit_id = $1", [visitId]);
    expect(queueEventsAfter.rows[0].count).toBe(queueEventsBefore.rows[0].count);

    const visitRow = await pool.query("SELECT status FROM visits WHERE id = $1", [visitId]);
    expect(visitRow.rows[0].status).toBe("CANCELLED"); // unchanged by the failed completion attempt
  });
});
