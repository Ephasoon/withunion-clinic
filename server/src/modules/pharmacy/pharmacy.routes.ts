import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { DispenseRequestSchema } from "./pharmacy.schema";
import {
  getPrescriptionDetail,
  listPendingPrescriptions,
  startPharmacyWork,
  dispense,
  completePharmacy,
  PharmacyPrescriptionDetail,
} from "./pharmacy.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES, Role } from "../roles/roles";

export const pharmacyRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

/**
 * inventoryItemId is stock-linkage information -- per the approved
 * authorization matrix, only Pharmacy and Owner see it. Every other
 * authenticated role gets the clinical prescription facts (medicine,
 * dosage, quantity, dispensing status) with that one field stripped.
 * dispensedBy/dispensedAt stay visible to all roles -- they answer
 * "was this dispensed and when", ordinary clinical review
 * information, not a stock-system internal identifier the way
 * inventoryItemId is.
 */
function redactForRole(detail: PharmacyPrescriptionDetail, role: Role): PharmacyPrescriptionDetail {
  if (role === ROLES.PHARMACY || role === ROLES.OWNER) {
    return detail;
  }
  return {
    ...detail,
    items: detail.items.map((item) => ({ ...item, inventoryItemId: null })),
  };
}

// Pharmacy-only listing, matching Laboratory's precedent of keeping
// the technician's operational queue role-restricted rather than
// open to every authenticated role.
pharmacyRouter.get("/prescriptions", requireAuth, requireRole(ROLES.PHARMACY), async (_req, res, next) => {
  try {
    const prescriptions = await listPendingPrescriptions();
    res.json({ data: { prescriptions }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// Open to any authenticated role, with inventory linkage redacted
// for everyone except Pharmacy/Owner (see redactForRole above).
pharmacyRouter.get("/prescriptions/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const prescription = await getPrescriptionDetail(req.params.id);
    if (!prescription) {
      throw new AppError(404, "NOT_FOUND", "Prescription not found");
    }
    res.json({
      data: { prescription: redactForRole(prescription, req.session.user!.role) },
      error: null,
      meta: null,
    });
  } catch (err) {
    next(err);
  }
});

// WAITING_FOR_PHARMACY -> AT_PHARMACY via the existing transitionVisit().
pharmacyRouter.post(
  "/prescriptions/:id/start",
  requireAuth,
  requireRole(ROLES.PHARMACY),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const prescription = await startPharmacyWork(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "pharmacy.start",
        entity: "prescriptions",
        entityId: req.params.id,
        afterValue: { visitStatus: prescription.visitStatus },
        ipAddress: req.ip,
      });
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: prescription.visitId,
        beforeValue: { status: "WAITING_FOR_PHARMACY" },
        afterValue: { status: "AT_PHARMACY", reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { prescription }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

pharmacyRouter.post(
  "/prescriptions/:id/dispense",
  requireAuth,
  requireRole(ROLES.PHARMACY),
  validateBody(DispenseRequestSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const { prescription, writes } = await dispense(req.params.id, req.session.user!.id, req.body);

      for (const write of writes) {
        if (write.kind === "dispense") {
          await recordAudit({
            userId: req.session.user!.id,
            action: "prescription_item.dispense",
            entity: "prescription_items",
            entityId: write.itemId,
            afterValue: { quantityDispensed: write.quantityDispensed, status: write.status },
            ipAddress: req.ip,
          });
          await recordAudit({
            userId: req.session.user!.id,
            action: "inventory_item.stock_decrement",
            entity: "pharmacy_inventory_items",
            entityId: write.inventoryItemId ?? null,
            beforeValue: { quantityOnHand: write.stockBefore },
            afterValue: { quantityOnHand: write.stockAfter },
            ipAddress: req.ip,
          });
        } else {
          await recordAudit({
            userId: req.session.user!.id,
            action: "prescription_item.mark_unavailable",
            entity: "prescription_items",
            entityId: write.itemId,
            afterValue: { status: "UNAVAILABLE" },
            ipAddress: req.ip,
          });
        }
      }

      res.json({ data: { prescription }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// AT_PHARMACY -> WAITING_FOR_BILLING via the existing transitionVisit(),
// only once no item remains PENDING.
pharmacyRouter.post(
  "/prescriptions/:id/complete",
  requireAuth,
  requireRole(ROLES.PHARMACY),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const { prescription, visitStatus } = await completePharmacy(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "pharmacy.complete",
        entity: "prescriptions",
        entityId: req.params.id,
        afterValue: { visitStatus },
        ipAddress: req.ip,
      });
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: prescription.visitId,
        beforeValue: { status: "AT_PHARMACY" },
        afterValue: { status: "WAITING_FOR_BILLING", reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { prescription, visitStatus }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);