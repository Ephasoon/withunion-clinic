import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreateSupplierSchema, UpdateSupplierSchema } from "./suppliers.schema";
import { createSupplier, listSuppliers, getSupplierById, updateSupplier } from "./suppliers.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const suppliersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// All Supplier endpoints are owner-only, including reads — unlike
// clinical data, no other role has a legitimate reason to see
// supplier records (approved decision, departing from the
// open-to-all-roles read pattern used elsewhere in this project).
suppliersRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const suppliers = await listSuppliers();
    res.json({ data: { suppliers }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

suppliersRouter.get("/:id", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const supplier = await getSupplierById(req.params.id);
    if (!supplier) {
      throw new AppError(404, "NOT_FOUND", "Supplier not found");
    }
    res.json({ data: { supplier }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

suppliersRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(CreateSupplierSchema),
  async (req, res, next) => {
    try {
      const supplier = await createSupplier(req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "supplier.create",
        entity: "suppliers",
        entityId: supplier.id,
        afterValue: supplier,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { supplier }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Covers both ordinary field updates and deactivate/reactivate via
// isActive — no delete endpoint exists. A deactivation specifically
// (isActive: false) additionally records supplier.deactivate, its
// own distinct audit action, mirroring the Users module's
// user.deactivate precedent rather than folding it into a generic
// "update" entry.
suppliersRouter.patch(
  "/:id",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(UpdateSupplierSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const before = await getSupplierById(req.params.id);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Supplier not found");
      }
      const updated = await updateSupplier(req.params.id, req.body);

      await recordAudit({
        userId: req.session.user!.id,
        action: "supplier.update",
        entity: "suppliers",
        entityId: req.params.id,
        beforeValue: before,
        afterValue: updated,
        ipAddress: req.ip,
      });

      if (req.body.isActive === false && before.isActive) {
        await recordAudit({
          userId: req.session.user!.id,
          action: "supplier.deactivate",
          entity: "suppliers",
          entityId: req.params.id,
          ipAddress: req.ip,
        });
      }

      res.json({ data: { supplier: updated }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
