import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreatePriceListItemSchema, UpdatePriceListItemSchema } from "./price-list.schema";
import {
  createPriceListItem,
  listPriceListItems,
  getPriceListItemById,
  updatePriceListItem,
} from "./price-list.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const priceListRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// All Price List endpoints are owner-only, including reads — same
// access rule as Suppliers.
priceListRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const items = await listPriceListItems();
    res.json({ data: { items }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

priceListRouter.get("/:id", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const item = await getPriceListItemById(req.params.id);
    if (!item) {
      throw new AppError(404, "NOT_FOUND", "Price list item not found");
    }
    res.json({ data: { item }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

priceListRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(CreatePriceListItemSchema),
  async (req, res, next) => {
    try {
      const item = await createPriceListItem(req.body, req.session.user!.id);
      await recordAudit({
        userId: req.session.user!.id,
        action: "price_list_item.create",
        entity: "price_list_items",
        entityId: item.id,
        afterValue: item,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { item }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Covers both ordinary field updates and deactivate/reactivate via
// isActive — no delete endpoint exists. A deactivation specifically
// (isActive: false) additionally records price_list_item.deactivate,
// mirroring Suppliers' supplier.deactivate.
priceListRouter.patch(
  "/:id",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(UpdatePriceListItemSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const before = await getPriceListItemById(req.params.id);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Price list item not found");
      }
      const updated = await updatePriceListItem(req.params.id, req.body);

      await recordAudit({
        userId: req.session.user!.id,
        action: "price_list_item.update",
        entity: "price_list_items",
        entityId: req.params.id,
        beforeValue: before,
        afterValue: updated,
        ipAddress: req.ip,
      });

      if (req.body.isActive === false && before.isActive) {
        await recordAudit({
          userId: req.session.user!.id,
          action: "price_list_item.deactivate",
          entity: "price_list_items",
          entityId: req.params.id,
          ipAddress: req.ip,
        });
      }

      res.json({ data: { item: updated }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
