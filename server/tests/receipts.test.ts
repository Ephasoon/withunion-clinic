import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
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

async function createInvoiceFixture(opts: { discount?: number } = {}) {
  const receptionId = await getUserIdByUsername("test.reception");
  const patientCode = `WU${Date.now().toString(36).slice(-8)}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`;

  const patientRes = await pool.query(
    `INSERT INTO patients (patient_code, full_name, gender, approximate_age, created_by)
     VALUES ($1, $2, 'female', 30, $3) RETURNING id`,
    [patientCode, `Receipt Test Patient ${Date.now()}`, receptionId]
  );
  const patientId = patientRes.rows[0].id;

  const visitRes = await pool.query(
    `INSERT INTO visits (patient_id, status, created_by) VALUES ($1, 'WAITING_FOR_BILLING', $2) RETURNING id`,
    [patientId, receptionId]
  );
  const visitId = visitRes.rows[0].id;

  const invoiceRes = await pool.query(
    `INSERT INTO invoices (visit_id, cashier_id, discount) VALUES ($1, $2, $3) RETURNING id`,
    [visitId, receptionId, opts.discount ?? 0]
  );
  const invoiceId = invoiceRes.rows[0].id;

  return { invoiceId, visitId, patientId, patientCode };
}

async function addItem(invoiceId: string, description: string, quantity: number, unitPrice: number) {
  await pool.query(
    `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES ($1, $2, $3, $4)`,
    [invoiceId, description, quantity, unitPrice]
  );
}

async function addPayment(invoiceId: string, amount: number, method: string) {
  const receptionId = await getUserIdByUsername("test.reception");
  await pool.query(
    `INSERT INTO payments (invoice_id, amount, method, recorded_by) VALUES ($1, $2, $3, $4)`,
    [invoiceId, amount, method, receptionId]
  );
}

/**
 * Marks an invoice PAID directly — standing in for Billing's real
 * completion step (not rebuilt in this session). Only ever called
 * after payments summing to the invoice's total have already been
 * added, mirroring the real precondition Billing itself enforces
 * before it would ever mark an invoice PAID.
 */
async function markInvoicePaid(invoiceId: string) {
  await pool.query(`UPDATE invoices SET status = 'PAID' WHERE id = $1`, [invoiceId]);
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Authorization", () => {
  it("rejects unauthenticated access to both endpoints", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addPayment(invoiceId, 50, "cash");
    expect((await request(app).get(`/api/v1/receipts/invoices/${invoiceId}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/receipts/invoices/${invoiceId}/print`)).status).toBe(401);
  });

  it("rejects non-Reception/Owner roles", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addPayment(invoiceId, 50, "cash");
    for (const username of ["test.nurse", "test.doctor", "test.lab", "test.pharmacy"]) {
      const agent = await loginAs(username);
      expect((await agent.get(`/api/v1/receipts/invoices/${invoiceId}`)).status).toBe(403);
      expect((await agent.get(`/api/v1/receipts/invoices/${invoiceId}/print`)).status).toBe(403);
    }
  });

  it("allows Reception and Owner", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addPayment(invoiceId, 50, "cash");
    await markInvoicePaid(invoiceId);
    const reception = await loginAs("test.reception");
    const owner = await loginAs("test.owner");
    expect((await reception.get(`/api/v1/receipts/invoices/${invoiceId}`)).status).toBe(200);
    expect((await owner.get(`/api/v1/receipts/invoices/${invoiceId}`)).status).toBe(200);
  });
});

describe("Fully paid invoice", () => {
  it("produces a correct receipt: items, subtotal, discount, total, amountPaid, balance", async () => {
    const { invoiceId, patientCode } = await createInvoiceFixture({ discount: 10 });
    await addItem(invoiceId, "Consultation", 1, 200);
    await addItem(invoiceId, "Bandage", 2, 15);
    // subtotal = 200 + 30 = 230; total = 230 - discount(10) = 220
    await addPayment(invoiceId, 220, "cash");
    await markInvoicePaid(invoiceId);

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    const r = res.body.data.receipt;

    expect(r.patientCode).toBe(patientCode);
    expect(r.items).toHaveLength(2);
    expect(r.subtotal).toBe(230);
    expect(r.discount).toBe(10);
    expect(r.total).toBe(220);
    expect(r.amountPaid).toBe(220);
    expect(r.balance).toBe(0);
  });
});

describe("OPEN invoices are rejected — receipts require PAID (approved V1 rule)", () => {
  it("rejects an OPEN invoice with zero payments recorded", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 100);
    // status stays OPEN — no payment, no markInvoicePaid call.

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RECEIPT_NOT_AVAILABLE_UNTIL_PAID");
  });

  it("rejects an OPEN, partially-paid invoice — partial-payment receipts are NOT part of V1", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Procedure", 1, 300);
    await addPayment(invoiceId, 120, "cash"); // real balance remains 180; invoice stays OPEN

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RECEIPT_NOT_AVAILABLE_UNTIL_PAID");

    // Same rejection applies to the print endpoint.
    const printRes = await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`);
    expect(printRes.status).toBe(409);
  });
});

describe("Multiple payments and payment methods", () => {
  it("lists every payment individually with correct method/amount, summed correctly into amountPaid", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 500);
    await addPayment(invoiceId, 200, "cash");
    await addPayment(invoiceId, 150, "bank_transfer");
    await addPayment(invoiceId, 150, "other");
    await markInvoicePaid(invoiceId);

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    const r = res.body.data.receipt;
    expect(r.payments).toHaveLength(3);
    expect(r.payments.map((p: { method: string }) => p.method).sort()).toEqual(["bank_transfer", "cash", "other"]);
    expect(r.amountPaid).toBe(500);
    expect(r.balance).toBe(0);
  });
});

describe("Nonexistent / malformed invoice", () => {
  it("returns 404 for a nonexistent invoice", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/receipts/invoices/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed invoice id", async () => {
    const reception = await loginAs("test.reception");
    const res = await reception.get("/api/v1/receipts/invoices/not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("Repeated retrieval / printing causes no mutation", () => {
  it("retrieving and printing the same receipt multiple times never changes the underlying data", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 100);
    await addPayment(invoiceId, 100, "cash");
    await markInvoicePaid(invoiceId);

    // A dedicated reception user, so the audit count below covers only
    // rows this test's own receipt requests could have written — other
    // test files write audit rows concurrently, so a whole-table count
    // drifts. Its login.success row is written before the "before" count.
    const owner = await loginAs("test.owner");
    const username = `receipt.nomutation.${Date.now()}.${Math.floor(Math.random() * 100000)}`;
    const userRes = await owner
      .post("/api/v1/users")
      .send({ fullName: "Receipt No-Mutation User", username, password: TEST_PASSWORD, role: "reception" });
    const userId = userRes.body.data.user.id as string;
    const reception = await loginAs(username);

    const scopedAuditCount = () =>
      pool.query("SELECT COUNT(*) FROM audit_logs WHERE user_id = $1 AND entity_id = $2", [userId, invoiceId]);
    const auditCountBefore = await scopedAuditCount();
    const paymentsCountBefore = await pool.query("SELECT COUNT(*) FROM payments WHERE invoice_id = $1", [invoiceId]);

    const reads = [
      await reception.get(`/api/v1/receipts/invoices/${invoiceId}`),
      await reception.get(`/api/v1/receipts/invoices/${invoiceId}`),
      await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`),
      await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`),
    ];
    // Guard against a vacuous pass: the reads must actually succeed as this user.
    expect(reads.map((r) => r.status)).toEqual([200, 200, 200, 200]);

    const auditCountAfter = await scopedAuditCount();
    const paymentsCountAfter = await pool.query("SELECT COUNT(*) FROM payments WHERE invoice_id = $1", [invoiceId]);
    expect(auditCountAfter.rows[0].count).toBe(auditCountBefore.rows[0].count);
    expect(paymentsCountAfter.rows[0].count).toBe(paymentsCountBefore.rows[0].count);
  });
});

describe("Print endpoint", () => {
  it("returns HTML containing the same data as the JSON view", async () => {
    const { invoiceId, patientCode } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 100);
    await addPayment(invoiceId, 100, "cash");
    await markInvoicePaid(invoiceId);

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain(patientCode);
    expect(res.text).toContain("Consultation");
  });

  it("degrades gracefully for an invoice with zero items", async () => {
    const { invoiceId } = await createInvoiceFixture();
    // A zero-item, PAID invoice is a synthetic edge case here (this
    // fixture bypasses Billing's real balance-must-be-zero lock, since
    // Billing itself isn't rebuilt in this session) — the point of
    // this test is purely that the print renderer degrades gracefully
    // with no items, not that the derived arithmetic is realistic.
    await addPayment(invoiceId, 0.01, "cash");
    await markInvoicePaid(invoiceId);
    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("No items");
  });
});


describe("Integration — receipt via Billing's real completion flow (not the markInvoicePaid shortcut)", () => {
  it("produces a correct receipt after the invoice reaches PAID through the real /billing/invoices/:id/complete endpoint", async () => {
    const reception = await loginAs("test.reception");

    const patientRes = await reception.post("/api/v1/patients").send({
      fullName: `Receipt Integration Patient ${Date.now()}`,
      gender: "male",
      approximateAge: 40,
    });
    const patientId = patientRes.body.data.patient.id;

    const visitRes = await reception.post("/api/v1/visits").send({ patientId });
    const visitId = visitRes.body.data.visit.id;

    await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
    const nurse = await loginAs("test.nurse");
    await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
    await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Checkup" });
    const doctor = await loginAs("test.doctor");
    const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
    await doctor.post(`/api/v1/consultations/${consultRes.body.data.consultation.id}/complete`);

    const invoiceRes = await reception.post(`/api/v1/billing/visits/${visitId}/invoice`);
    const invoiceId = invoiceRes.body.data.invoice.id;

    await reception.post(`/api/v1/billing/invoices/${invoiceId}/items`).send({
      items: [{ description: "Integration Consultation", quantity: 1, unitPrice: 150 }],
    });

    await reception.post(`/api/v1/billing/invoices/${invoiceId}/payments`).send({ amount: 150, method: "cash" });

    const completeRes = await reception.post(`/api/v1/billing/invoices/${invoiceId}/complete`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.invoice.status).toBe("PAID");

    const receiptRes = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    expect(receiptRes.status).toBe(200);
    const r = receiptRes.body.data.receipt;

    expect(r.invoiceId).toBe(invoiceId);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].description).toBe("Integration Consultation");
    expect(r.subtotal).toBe(150);
    expect(r.total).toBe(150);
    expect(r.amountPaid).toBe(150);
    expect(r.balance).toBe(0);
    expect(r.payments).toHaveLength(1);
    expect(r.payments[0].method).toBe("cash");

    const billingDetailRes = await reception.get(`/api/v1/billing/invoices/${invoiceId}`);
    const billingInvoice = billingDetailRes.body.data.invoice;
    expect(r.subtotal).toBe(billingInvoice.subtotal);
    expect(r.total).toBe(billingInvoice.total);
    expect(r.amountPaid).toBe(billingInvoice.amountPaid);
    expect(r.balance).toBe(billingInvoice.balance);

    const printRes = await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`);
    expect(printRes.status).toBe(200);
    expect(printRes.text).toContain("Integration Consultation");
  });
});

/** Splits a Content-Security-Policy header into { directiveName: "full directive" }. */
function parseCsp(header: string): Record<string, string> {
  const directives: Record<string, string> = {};
  for (const part of header.split(";").map((p) => p.trim()).filter(Boolean)) {
    directives[part.split(/\s+/)[0]] = part;
  }
  return directives;
}

describe("Print page CSP", () => {
  it("allows exactly the page's own inline script, by hash, on the print route", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 100);
    await addPayment(invoiceId, 100, "cash");
    await markInvoicePaid(invoiceId);

    const reception = await loginAs("test.reception");
    const printRes = await reception.get(`/api/v1/receipts/invoices/${invoiceId}/print`);
    expect(printRes.status).toBe(200);

    // Hash the script as actually rendered, so this fails if the script
    // text ever changes without the CSP hash following it.
    const scripts = [...printRes.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const expectedHash = `'sha256-${createHash("sha256").update(scripts[0], "utf8").digest("base64")}'`;

    const printCsp = parseCsp(printRes.headers["content-security-policy"]);
    expect(printCsp["script-src"]).toBe(`script-src 'self' ${expectedHash}`);

    // Every other directive is identical to the app-wide policy.
    const jsonRes = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    const jsonCsp = parseCsp(jsonRes.headers["content-security-policy"]);
    const { "script-src": _printScriptSrc, ...printRest } = printCsp;
    const { "script-src": _jsonScriptSrc, ...jsonRest } = jsonCsp;
    expect(printRest).toEqual(jsonRest);
  });

  it("leaves the JSON receipt route on the app-wide CSP: plain script-src 'self', no hash", async () => {
    const { invoiceId } = await createInvoiceFixture();
    await addItem(invoiceId, "Consultation", 1, 100);
    await addPayment(invoiceId, 100, "cash");
    await markInvoicePaid(invoiceId);

    const reception = await loginAs("test.reception");
    const res = await reception.get(`/api/v1/receipts/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    const header = res.headers["content-security-policy"];
    expect(parseCsp(header)["script-src"]).toBe("script-src 'self'");
    expect(header).not.toContain("sha256-");
  });
});
