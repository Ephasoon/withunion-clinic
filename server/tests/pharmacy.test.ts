import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { seedTestUsers, closeTestPool, createTestPatient, TEST_PASSWORD } from "./setup";
import { pool } from "../src/config/db";
import { dispense } from "../src/modules/pharmacy/pharmacy.service";

const app = createApp();

async function loginAs(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username, password: TEST_PASSWORD });
  return agent;
}

function uniqueName(base: string) {
  return `${base} ${Date.now()}-${Math.random()}`;
}

async function createStockItem(quantityOnHand: number, unit = "tablet") {
  const owner = await loginAs("test.owner");
  const name = uniqueName("Stock Item");
  const res = await owner.post("/api/v1/inventory/items").send({ name, unit, quantityOnHand });
  return res.body.data.item.id as string;
}

/**
 * Builds a visit through Nursing and Consultation to a prescription
 * sitting at WAITING_FOR_PHARMACY — reusing the real modules end to
 * end, same pattern as the Laboratory test suite's
 * createOrderWaitingForLab().
 */
async function createPrescriptionWaitingForPharmacy(
  items: Array<{ medicineName: string; quantityPrescribed?: number }> = [{ medicineName: "Paracetamol", quantityPrescribed: 20 }]
) {
  const reception = await loginAs("test.reception");
  const patient = await createTestPatient(`Pharmacy Test Patient ${Date.now()}-${Math.random()}`);
  const visitRes = await reception.post("/api/v1/visits").send({ patientId: patient.id });
  const visitId = visitRes.body.data.visit.id as string;

  await reception.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WAITING_FOR_NURSE" });
  const nurse = await loginAs("test.nurse");
  await nurse.post(`/api/v1/visits/${visitId}/transition`).send({ toStatus: "WITH_NURSE" });
  await nurse.post(`/api/v1/visits/${visitId}/nursing-assessment`).send({ chiefComplaint: "Fever" });

  const doctor = await loginAs("test.doctor");
  const consultRes = await doctor.post(`/api/v1/visits/${visitId}/consultations`);
  const consultationId = consultRes.body.data.consultation.id as string;
  const prescriptionRes = await doctor
    .post(`/api/v1/consultations/${consultationId}/prescriptions`)
    .send({ items });
  const prescriptionId = prescriptionRes.body.data.prescription.id as string;
  await doctor.post(`/api/v1/consultations/${consultationId}/complete`); // -> WAITING_FOR_PHARMACY

  return { reception, doctor, visitId, consultationId, prescriptionId };
}

async function startPharmacyAsTech(prescriptionId: string) {
  const pharmacy = await loginAs("test.pharmacy");
  const res = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/start`);
  return { pharmacy, res };
}

beforeAll(async () => {
  await seedTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});

describe("Retrieval", () => {
  it("PHARMACY can retrieve pending/current prescriptions", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy();
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.get("/api/v1/pharmacy/prescriptions");
    expect(res.status).toBe(200);
    expect(res.body.data.prescriptions.some((p: { id: string }) => p.id === prescriptionId)).toBe(true);
  });

  it("non-pharmacy roles cannot list", async () => {
    const doctor = await loginAs("test.doctor");
    const res = await doctor.get("/api/v1/pharmacy/prescriptions");
    expect(res.status).toBe(403);
  });

  it("individual prescription can be retrieved with items", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "Ibuprofen", quantityPrescribed: 10 }]);
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].medicineName).toBe("Ibuprofen");
    expect(res.body.data.prescription.items[0].status).toBe("PENDING");
  });

  it("returns the project's normal 404 for a non-existent prescription", async () => {
    const pharmacy = await loginAs("test.pharmacy");
    const res = await pharmacy.get("/api/v1/pharmacy/prescriptions/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("doctor can retrieve prescription detail but inventoryItemId is redacted", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId, doctor } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });

    const res = await doctor.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].inventoryItemId).toBeNull();
    // Clinical facts remain visible.
    expect(res.body.data.prescription.items[0].status).toBe("DISPENSED");
    expect(res.body.data.prescription.items[0].quantityDispensed).toBe(5);
  });

  it("pharmacy and owner see the real inventoryItemId (not redacted)", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });

    const pharmacyView = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    expect(pharmacyView.body.data.prescription.items[0].inventoryItemId).toBe(stockId);

    const owner = await loginAs("test.owner");
    const ownerView = await owner.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    expect(ownerView.body.data.prescription.items[0].inventoryItemId).toBe(stockId);
  });
});

describe("Authorization", () => {
  it("RECEPTION cannot start pharmacy work", async () => {
    const { prescriptionId, reception } = await createPrescriptionWaitingForPharmacy();
    const res = await reception.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/start`);
    expect(res.status).toBe(403);
  });

  it("NURSE cannot dispense", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy();
    await startPharmacyAsTech(prescriptionId);
    const nurse = await loginAs("test.nurse");
    const res = await nurse
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId: "00000000-0000-0000-0000-000000000000", markUnavailable: true }] });
    expect(res.status).toBe(403);
  });

  it("DOCTOR cannot start pharmacy work", async () => {
    const { prescriptionId, doctor } = await createPrescriptionWaitingForPharmacy();
    const res = await doctor.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/start`);
    expect(res.status).toBe(403);
  });

  it("LAB_TECH cannot complete pharmacy work", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy();
    await startPharmacyAsTech(prescriptionId);
    const lab = await loginAs("test.lab");
    const res = await lab.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);
    expect(res.status).toBe(403);
  });

  it("PHARMACY can perform every permitted action end to end", async () => {
    const stockId = await createStockItem(100);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 10 }]);
    const { pharmacy, res: startRes } = await startPharmacyAsTech(prescriptionId);
    expect(startRes.status).toBe(200);

    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    const dispenseRes = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 10 }] });
    expect(dispenseRes.status).toBe(200);

    const completeRes = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.visitStatus).toBe("WAITING_FOR_BILLING");
  });
});

describe("Start", () => {
  it("valid WAITING_FOR_PHARMACY -> AT_PHARMACY", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy();
    const { res } = await startPharmacyAsTech(prescriptionId);
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.visitStatus).toBe("AT_PHARMACY");
  });

  it("invalid start from another queue state is rejected", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy();
    await startPharmacyAsTech(prescriptionId); // now AT_PHARMACY
    const { res } = await startPharmacyAsTech(prescriptionId); // second start
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });
});

describe("Dispensing — quantity-based items", () => {
  it("a full dispense marks the item DISPENSED and decrements stock", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 10 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].status).toBe("DISPENSED");
    expect(res.body.data.prescription.items[0].quantityDispensed).toBe(10);

    const stockRes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockId]);
    expect(stockRes.rows[0].quantity_on_hand).toBe(40);
  });

  it("a partial dispense marks the item PARTIALLY_DISPENSED", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 20 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 8 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].status).toBe("PARTIALLY_DISPENSED");
    expect(res.body.data.prescription.items[0].quantityDispensed).toBe(8);
  });

  it("a subsequent partial dispense tops up correctly to DISPENSED", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 20 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 8 }] });
    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 12 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].status).toBe("DISPENSED");
    expect(res.body.data.prescription.items[0].quantityDispensed).toBe(20);
  });

  it("rejects exceeding quantityPrescribed, stock unchanged", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 10 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 15 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EXCEEDS_PRESCRIBED_QUANTITY");

    const stockRes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockId]);
    expect(stockRes.rows[0].quantity_on_hand).toBe(50);
  });

  it("rejects dispensing beyond available stock (insufficient stock), quantityDispensed unchanged", async () => {
    const stockId = await createStockItem(3);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 10 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");

    const itemRes = await pool.query("SELECT quantity_dispensed, status FROM prescription_items WHERE id = $1", [itemId]);
    expect(itemRes.rows[0].quantity_dispensed).toBeNull();
    expect(itemRes.rows[0].status).toBe("PENDING");
    const stockRes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockId]);
    expect(stockRes.rows[0].quantity_on_hand).toBe(3);
  });

  it("rejects dispensing again on an already-DISPENSED item", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_ALREADY_TERMINAL");
  });

  it("rejects a foreign itemId (belonging to a different prescription)", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId: rxA } = await createPrescriptionWaitingForPharmacy([{ medicineName: "A", quantityPrescribed: 5 }]);
    const { prescriptionId: rxB } = await createPrescriptionWaitingForPharmacy([{ medicineName: "B", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(rxA);
    await startPharmacyAsTech(rxB);
    const pharmacy = await loginAs("test.pharmacy");
    const detailB = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${rxB}`);
    const foreignItemId = detailB.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${rxA}/dispense`)
      .send({ items: [{ itemId: foreignItemId, inventoryItemId: stockId, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ITEM_NOT_IN_PRESCRIPTION");
  });

  it("rejects dispensing outside AT_PHARMACY (still WAITING_FOR_PHARMACY)", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });

  it("rejects dispensing after pharmacy completion", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });
    await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_VISIT_STATE");
  });
});

describe("Dispensing — NULL quantityPrescribed", () => {
  it("one successful dispense marks the item DISPENSED regardless of requested quantity", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X" }]); // no quantityPrescribed
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const item = detail.body.data.prescription.items[0];
    expect(item.quantityPrescribed).toBeNull();

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId: item.id, inventoryItemId: stockId, quantity: 3 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].status).toBe("DISPENSED");
  });

  it("a further dispense attempt on that item is rejected", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X" }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 1 }] });

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_ALREADY_TERMINAL");
  });
});

describe("Mark unavailable", () => {
  it("legal from PENDING, no stock touched", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, markUnavailable: true }] });
    expect(res.status).toBe(200);
    expect(res.body.data.prescription.items[0].status).toBe("UNAVAILABLE");

    const stockRes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockId]);
    expect(stockRes.rows[0].quantity_on_hand).toBe(50);
  });

  it("illegal once the item is already DISPENSED", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });

    const res = await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, markUnavailable: true }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_ALREADY_TERMINAL");
  });
});

describe("Completion", () => {
  it("blocked while any item remains PENDING", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([
      { medicineName: "A", quantityPrescribed: 5 },
      { medicineName: "B", quantityPrescribed: 5 },
    ]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const items = detail.body.data.prescription.items;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId: items[0].id, inventoryItemId: stockId, quantity: 5 }] }); // only item A

    const res = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INCOMPLETE_DISPENSING");
  });

  it("succeeds once every item is non-PENDING (mixture of DISPENSED and UNAVAILABLE)", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([
      { medicineName: "A", quantityPrescribed: 5 },
      { medicineName: "B", quantityPrescribed: 5 },
    ]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const items = detail.body.data.prescription.items;
    await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`).send({
      items: [
        { itemId: items[0].id, inventoryItemId: stockId, quantity: 5 },
        { itemId: items[1].id, markUnavailable: true },
      ],
    });

    const res = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.data.visitStatus).toBe("WAITING_FOR_BILLING");
  });

  it("produces the expected queue event through the existing transition mechanism", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId, visitId, doctor } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });
    await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/complete`);

    const visitDetail = await doctor.get(`/api/v1/visits/${visitId}`);
    const lastEvent = visitDetail.body.data.history[visitDetail.body.data.history.length - 1];
    expect(lastEvent.fromStatus).toBe("AT_PHARMACY");
    expect(lastEvent.toStatus).toBe("WAITING_FOR_BILLING");
  });
});

describe("Audit entries", () => {
  it("a dispense produces both prescription_item.dispense and inventory_item.stock_decrement entries", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const before = new Date();
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] });

    const auditRes = await pool.query(
      `SELECT action, entity_id FROM audit_logs WHERE created_at >= $1 AND action IN ('prescription_item.dispense', 'inventory_item.stock_decrement') ORDER BY created_at`,
      [before]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("prescription_item.dispense");
    expect(actions).toContain("inventory_item.stock_decrement");
  });

  it("mark-unavailable produces only the item-level entry, no stock entry", async () => {
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 5 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const before = new Date();
    await pharmacy
      .post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`)
      .send({ items: [{ itemId, markUnavailable: true }] });

    const auditRes = await pool.query(
      `SELECT action FROM audit_logs WHERE created_at >= $1 AND entity_id = $2`,
      [before, itemId]
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain("prescription_item.mark_unavailable");
    expect(actions).not.toContain("inventory_item.stock_decrement");
  });
});

describe("Transaction atomicity", () => {
  it("a real foreign-key violation (dispensed_by referencing a non-existent user) rolls back both the stock decrement and the item update", async () => {
    const stockId = await createStockItem(50);
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([{ medicineName: "X", quantityPrescribed: 10 }]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const itemId = detail.body.data.prescription.items[0].id;

    const bogusUserId = "00000000-0000-0000-0000-000000000000"; // well-formed UUID, no such user

    // Calling the service directly (bypassing the route's
    // session-derived real user id) to force a genuine Postgres
    // foreign-key violation on dispensed_by — the real FK constraint
    // added by this phase's migration, not a mock or weakened schema.
    await expect(
      dispense(prescriptionId, bogusUserId, { items: [{ itemId, inventoryItemId: stockId, quantity: 5 }] })
    ).rejects.toThrow();

    // Prove BOTH halves of the write rolled back: stock is untouched,
    // and the item is still PENDING with no dispensed quantity.
    const stockRes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockId]);
    expect(stockRes.rows[0].quantity_on_hand).toBe(50);
    const itemRes = await pool.query("SELECT quantity_dispensed, status FROM prescription_items WHERE id = $1", [itemId]);
    expect(itemRes.rows[0].quantity_dispensed).toBeNull();
    expect(itemRes.rows[0].status).toBe("PENDING");
  });

  it("a multi-item batch where the second item fails rolls back the first item's already-applied writes too", async () => {
    const stockA = await createStockItem(50);
    const stockB = await createStockItem(2); // deliberately insufficient for the second item
    const { prescriptionId } = await createPrescriptionWaitingForPharmacy([
      { medicineName: "A", quantityPrescribed: 10 },
      { medicineName: "B", quantityPrescribed: 10 },
    ]);
    await startPharmacyAsTech(prescriptionId);
    const pharmacy = await loginAs("test.pharmacy");
    const detail = await pharmacy.get(`/api/v1/pharmacy/prescriptions/${prescriptionId}`);
    const items = detail.body.data.prescription.items;

    const res = await pharmacy.post(`/api/v1/pharmacy/prescriptions/${prescriptionId}/dispense`).send({
      items: [
        { itemId: items[0].id, inventoryItemId: stockA, quantity: 5 }, // would succeed alone
        { itemId: items[1].id, inventoryItemId: stockB, quantity: 5 }, // fails: insufficient stock
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");

    // Item A's write must NOT have persisted despite being processed
    // first and being individually valid — proving whole-batch rollback.
    const stockARes = await pool.query("SELECT quantity_on_hand FROM pharmacy_inventory_items WHERE id = $1", [stockA]);
    expect(stockARes.rows[0].quantity_on_hand).toBe(50);
    const itemARes = await pool.query("SELECT status, quantity_dispensed FROM prescription_items WHERE id = $1", [items[0].id]);
    expect(itemARes.rows[0].status).toBe("PENDING");
    expect(itemARes.rows[0].quantity_dispensed).toBeNull();
  });
});