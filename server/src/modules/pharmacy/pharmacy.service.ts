import { PoolClient } from "pg";
import { pool, withTransaction } from "../../config/db";
import { AppError } from "../../utils/appError";
import { transitionVisit } from "../visits/visits.service";
import { DispenseRequestInput, DispenseEntry } from "./pharmacy.schema";

export interface PharmacyItem {
  id: string;
  medicineName: string;
  strength: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  quantityPrescribed: number | null;
  quantityDispensed: number | null;
  status: string;
  inventoryItemId: string | null;
  dispensedBy: string | null;
  dispensedAt: string | null;
}

export interface PharmacyPrescriptionDetail {
  id: string;
  visitId: string;
  consultationId: string;
  doctorId: string;
  doctorName: string;
  visitStatus: string;
  patientCode: string;
  patientFullName: string;
  createdAt: string;
  items: PharmacyItem[];
}

interface PrescriptionRow {
  id: string;
  visit_id: string;
  consultation_id: string;
  doctor_id: string;
  doctor_name: string;
  visit_status: string;
  patient_code: string;
  patient_full_name: string;
  created_at: string;
}

interface ItemRow {
  id: string;
  prescription_id: string;
  medicine_name: string;
  strength: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  quantity_prescribed: number | null;
  quantity_dispensed: number | null;
  status: string;
  inventory_item_id: string | null;
  dispensed_by: string | null;
  dispensed_at: string | null;
}

const PRESCRIPTION_SELECT = `
  SELECT pr.id, pr.visit_id, pr.consultation_id, pr.doctor_id, u.full_name AS doctor_name,
         v.status AS visit_status, p.patient_code, p.full_name AS patient_full_name, pr.created_at
  FROM prescriptions pr
  JOIN visits v ON v.id = pr.visit_id
  JOIN patients p ON p.id = v.patient_id
  JOIN users u ON u.id = pr.doctor_id
`;

function toItem(row: ItemRow): PharmacyItem {
  return {
    id: row.id,
    medicineName: row.medicine_name,
    strength: row.strength,
    dosage: row.dosage,
    frequency: row.frequency,
    duration: row.duration,
    quantityPrescribed: row.quantity_prescribed,
    quantityDispensed: row.quantity_dispensed,
    status: row.status,
    inventoryItemId: row.inventory_item_id,
    dispensedBy: row.dispensed_by,
    dispensedAt: row.dispensed_at,
  };
}

async function getItemsForPrescription(prescriptionId: string): Promise<PharmacyItem[]> {
  const result = await pool.query<ItemRow>(
    `SELECT * FROM prescription_items WHERE prescription_id = $1 ORDER BY medicine_name ASC`,
    [prescriptionId]
  );
  return result.rows.map(toItem);
}

async function toDetail(row: PrescriptionRow): Promise<PharmacyPrescriptionDetail> {
  const items = await getItemsForPrescription(row.id);
  return {
    id: row.id,
    visitId: row.visit_id,
    consultationId: row.consultation_id,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    visitStatus: row.visit_status,
    patientCode: row.patient_code,
    patientFullName: row.patient_full_name,
    createdAt: row.created_at,
    items,
  };
}

export async function getPrescriptionDetail(prescriptionId: string): Promise<PharmacyPrescriptionDetail | null> {
  const result = await pool.query<PrescriptionRow>(`${PRESCRIPTION_SELECT} WHERE pr.id = $1`, [prescriptionId]);
  if (!result.rows[0]) return null;
  return toDetail(result.rows[0]);
}

/**
 * "Pending/current" pharmacy work — visit still WAITING_FOR_PHARMACY
 * or AT_PHARMACY, mirroring Laboratory's listPendingLabOrders().
 */
export async function listPendingPrescriptions(): Promise<PharmacyPrescriptionDetail[]> {
  const result = await pool.query<PrescriptionRow>(
    `${PRESCRIPTION_SELECT} WHERE v.status IN ('WAITING_FOR_PHARMACY', 'AT_PHARMACY') ORDER BY pr.created_at ASC`
  );
  return Promise.all(result.rows.map(toDetail));
}

/** WAITING_FOR_PHARMACY -> AT_PHARMACY via the existing transitionVisit(). */
export async function startPharmacyWork(
  prescriptionId: string,
  pharmacyUserId: string
): Promise<PharmacyPrescriptionDetail> {
  const prescription = await getPrescriptionDetail(prescriptionId);
  if (!prescription) {
    throw new AppError(404, "NOT_FOUND", "Prescription not found");
  }
  if (prescription.visitStatus !== "WAITING_FOR_PHARMACY") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Pharmacy work can only start while the visit is WAITING_FOR_PHARMACY (currently ${prescription.visitStatus})`
    );
  }

  await transitionVisit(prescription.visitId, "pharmacy", "AT_PHARMACY", undefined, pharmacyUserId);

  return (await getPrescriptionDetail(prescriptionId))!;
}

export interface DispenseWriteRecord {
  itemId: string;
  kind: "dispense" | "mark_unavailable";
  quantityDispensed?: number;
  status: string;
  inventoryItemId?: string;
  stockBefore?: number;
  stockAfter?: number;
}

export interface DispenseOutcome {
  prescription: PharmacyPrescriptionDetail;
  writes: DispenseWriteRecord[];
}

function isQuantityEntry(entry: DispenseEntry): entry is Extract<DispenseEntry, { quantity: number }> {
  return "quantity" in entry;
}

/**
 * Processes a batch of dispense/mark-unavailable actions for one
 * prescription, entirely inside a single withTransaction() call, per
 * the approved atomicity sequence: for each quantity entry - (1)
 * validate the item belongs to this prescription, (2) validate
 * against quantity_prescribed, (3) conditionally decrement stock,
 * (4) update the prescription item, (5) compute the resulting
 * status. Every statement uses the same transactional client - no
 * pool.query anywhere in this function body. If any entry in the
 * batch fails, everything already written earlier in the same call
 * rolls back.
 *
 * Audit writes happen after this function returns, at the route
 * layer - consistent with every prior module, where recordAudit() is
 * never called from inside a service's transaction. This function
 * returns enough detail (writes) for the route to construct those.
 */
export async function dispense(
  prescriptionId: string,
  pharmacyUserId: string,
  input: DispenseRequestInput
): Promise<DispenseOutcome> {
  const prescription = await getPrescriptionDetail(prescriptionId);
  if (!prescription) {
    throw new AppError(404, "NOT_FOUND", "Prescription not found");
  }
  if (prescription.visitStatus !== "AT_PHARMACY") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Dispensing can only happen while the visit is AT_PHARMACY (currently ${prescription.visitStatus})`
    );
  }

  const writes: DispenseWriteRecord[] = [];

  await withTransaction(async (client: PoolClient) => {
    for (const entry of input.items) {
      // Step 1: validate ownership/membership - this SELECT (scoped
      // to prescription_id) is what rejects a foreign itemId; FOR
      // UPDATE locks the row for the remainder of this transaction
      // so a concurrent dispense on the same item can't race past
      // this check with a stale view of its current state.
      const itemResult = await client.query<ItemRow>(
        `SELECT * FROM prescription_items WHERE id = $1 AND prescription_id = $2 FOR UPDATE`,
        [entry.itemId, prescriptionId]
      );
      const item = itemResult.rows[0];
      if (!item) {
        throw new AppError(
          400,
          "ITEM_NOT_IN_PRESCRIPTION",
          `Item ${entry.itemId} does not belong to prescription ${prescriptionId}`
        );
      }

      if (isQuantityEntry(entry)) {
        if (item.status === "DISPENSED" || item.status === "UNAVAILABLE") {
          throw new AppError(
            409,
            "ITEM_ALREADY_TERMINAL",
            `Item ${item.id} is already ${item.status} and cannot be dispensed further`
          );
        }

        // Step 2: prescribed-quantity validation before the stock
        // check, per the approved ordering (cheap check first).
        const currentDispensed = item.quantity_dispensed ?? 0;
        const newDispensed = currentDispensed + entry.quantity;
        let newStatus: string;

        if (item.quantity_prescribed === null) {
          // NULL quantity_prescribed: one successful dispense is
          // terminal. The DISPENSED/UNAVAILABLE guard above already
          // blocks any second attempt, so reaching here means this
          // is legitimately the first (and only) dispense.
          newStatus = "DISPENSED";
        } else {
          if (newDispensed > item.quantity_prescribed) {
            throw new AppError(
              400,
              "EXCEEDS_PRESCRIBED_QUANTITY",
              `Dispensing ${entry.quantity} would exceed the prescribed quantity for item ${item.id}`
            );
          }
          newStatus = newDispensed === item.quantity_prescribed ? "DISPENSED" : "PARTIALLY_DISPENSED";
        }

        // Step 3: conditional stock decrement - the actual atomic
        // over-dispensing guard. Zero rows affected means
        // insufficient stock; this throw aborts and rolls back the
        // whole batch.
        const stockResult = await client.query<{ quantity_on_hand: number }>(
          `UPDATE pharmacy_inventory_items
           SET quantity_on_hand = quantity_on_hand - $1, updated_at = now()
           WHERE id = $2 AND quantity_on_hand >= $1
           RETURNING quantity_on_hand`,
          [entry.quantity, entry.inventoryItemId]
        );
        if (stockResult.rowCount === 0) {
          throw new AppError(
            409,
            "INSUFFICIENT_STOCK",
            `Insufficient stock to dispense ${entry.quantity} of item ${item.id}`
          );
        }
        const stockAfter = stockResult.rows[0].quantity_on_hand;
        const stockBefore = stockAfter + entry.quantity;

        // Step 4 + 5: update the prescription item with the computed
        // quantity/status together with dispensing attribution.
        await client.query(
          `UPDATE prescription_items
           SET quantity_dispensed = $1, status = $2, inventory_item_id = $3,
               dispensed_by = $4, dispensed_at = now()
           WHERE id = $5`,
          [newDispensed, newStatus, entry.inventoryItemId, pharmacyUserId, item.id]
        );

        writes.push({
          itemId: item.id,
          kind: "dispense",
          quantityDispensed: newDispensed,
          status: newStatus,
          inventoryItemId: entry.inventoryItemId,
          stockBefore,
          stockAfter,
        });
      } else {
        // markUnavailable branch - only legal from PENDING; no stock
        // or dispensing-attribution fields are touched.
        if (item.status !== "PENDING") {
          throw new AppError(
            409,
            "ITEM_ALREADY_TERMINAL",
            `Item ${item.id} is already ${item.status} and cannot be marked unavailable`
          );
        }

        await client.query(`UPDATE prescription_items SET status = 'UNAVAILABLE' WHERE id = $1`, [item.id]);

        writes.push({ itemId: item.id, kind: "mark_unavailable", status: "UNAVAILABLE" });
      }
    }
  });

  const updatedPrescription = (await getPrescriptionDetail(prescriptionId))!;
  return { prescription: updatedPrescription, writes };
}

/**
 * Completes the pharmacy step and advances the visit, only once no
 * item remains PENDING. Unlike laboratory_orders.status (which
 * Laboratory deliberately left untouched), prescription_items.status
 * IS the authoritative fulfillment signal Pharmacy is responsible
 * for maintaining.
 */
export async function completePharmacy(
  prescriptionId: string,
  pharmacyUserId: string
): Promise<{ prescription: PharmacyPrescriptionDetail; visitStatus: string }> {
  const prescription = await getPrescriptionDetail(prescriptionId);
  if (!prescription) {
    throw new AppError(404, "NOT_FOUND", "Prescription not found");
  }
  if (prescription.visitStatus !== "AT_PHARMACY") {
    throw new AppError(
      409,
      "INVALID_VISIT_STATE",
      `Pharmacy work can only be completed while the visit is AT_PHARMACY (currently ${prescription.visitStatus})`
    );
  }

  const pending = prescription.items.filter((item) => item.status === "PENDING");
  if (pending.length > 0) {
    throw new AppError(
      409,
      "INCOMPLETE_DISPENSING",
      `Cannot complete: still pending for ${pending.map((i) => i.medicineName).join(", ")}`
    );
  }

  const visit = await transitionVisit(prescription.visitId, "pharmacy", "WAITING_FOR_BILLING", undefined, pharmacyUserId);

  return { prescription: (await getPrescriptionDetail(prescriptionId))!, visitStatus: visit.status };
}