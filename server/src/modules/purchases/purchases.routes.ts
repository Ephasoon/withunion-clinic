import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreatePurchaseSchema } from "./purchases.schema";
import { createPurchase, listPurchases, getPurchaseDetail, receivePurchase } from "./purchases.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const purchasesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

purchasesRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const purchases = await listPurchases();
    res.json({ data: { purchases }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

purchasesRouter.get("/:id", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const purchase = await getPurchaseDetail(req.params.id);
    if (!purchase) {
      throw new AppError(404, "NOT_FOUND", "Purchase not found");
    }
    res.json({ data: { purchase }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

purchasesRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(CreatePurchaseSchema),
  async (req, res, next) => {
    try {
      const purchase = await createPurchase(req.body, req.session.user!.id);
      await recordAudit({
        userId: req.session.user!.id,
        action: "purchase.create",
        entity: "purchases",
        entityId: purchase.id,
        afterValue: purchase,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { purchase }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

purchasesRouter.post("/:id/receive", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const { purchase, increments } = await receivePurchase(req.params.id, req.session.user!.id);

    await recordAudit({
      userId: req.session.user!.id,
      action: "purchase.receive",
      entity: "purchases",
      entityId: req.params.id,
      afterValue: { status: purchase.status },
      ipAddress: req.ip,
    });

    for (const inc of increments) {
      await recordAudit({
        userId: req.session.user!.id,
        action: "inventory_item.stock_increment",
        entity: "pharmacy_inventory_items",
        entityId: inc.inventoryItemId,
        beforeValue: { quantityOnHand: inc.stockBefore },
        afterValue: { quantityOnHand: inc.stockAfter },
        ipAddress: req.ip,
      });
    }

    res.json({ data: { purchase }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});
