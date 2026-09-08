import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreateInventoryItemSchema } from "./inventory.schema";
import { createInventoryItem, listInventoryItems } from "./inventory.service";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const inventoryRouter = Router();

// Owner-only — pharmacy has operational authority (dispense/decrement)
// but never creates or adjusts stock levels, per the Phase 2
// "owner = adjustments, pharmacy = operational only" correction.
inventoryRouter.post(
  "/items",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(CreateInventoryItemSchema),
  async (req, res, next) => {
    try {
      const item = await createInventoryItem(req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "inventory_item.create",
        entity: "pharmacy_inventory_items",
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

// Owner + Pharmacy only — the minimal listing Pharmacy needs to pick
// a stock line when dispensing. Not opened to every authenticated
// role, per the approved authorization matrix.
inventoryRouter.get(
  "/items",
  requireAuth,
  requireRole(ROLES.OWNER, ROLES.PHARMACY),
  async (_req, res, next) => {
    try {
      const items = await listInventoryItems();
      res.json({ data: { items }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);