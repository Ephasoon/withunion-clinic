import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { EnterResultsSchema } from "./laboratory.schema";
import {
  getLabOrderDetail,
  listPendingLabOrders,
  startLabWork,
  enterResults,
  completeLabOrder,
} from "./laboratory.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const laboratoryRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// LAB_TECH-only — this is the technician's operational queue (pending
// / current work), not a general listing. Doctors/other roles use
// GET /orders/:id to view a specific order instead (see below).
laboratoryRouter.get("/orders", requireAuth, requireRole(ROLES.LAB_TECH), async (_req, res, next) => {
  try {
    const orders = await listPendingLabOrders();
    res.json({ data: { orders }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// Open to any authenticated role, matching the read-access pattern
// already established by Patients/Visits/Nursing/Consultation — this
// is what supports both the LAB_TECH workflow and Doctor review.
laboratoryRouter.get("/orders/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const order = await getLabOrderDetail(req.params.id);
    if (!order) {
      throw new AppError(404, "NOT_FOUND", "Laboratory order not found");
    }
    res.json({ data: { order }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// WAITING_FOR_LAB -> AT_LAB via the existing transitionVisit().
laboratoryRouter.post(
  "/orders/:id/start",
  requireAuth,
  requireRole(ROLES.LAB_TECH),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const order = await startLabWork(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "lab_order.start",
        entity: "laboratory_orders",
        entityId: req.params.id,
        afterValue: { visitStatus: order.visitStatus },
        ipAddress: req.ip,
      });
      // transitionVisit() only writes the queue_events ledger row —
      // the visit.transition audit entry is written here at the route
      // layer, same convention as every other module that calls it.
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: order.visitId,
        beforeValue: { status: "WAITING_FOR_LAB" },
        afterValue: { status: "AT_LAB", reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { order }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

laboratoryRouter.post(
  "/orders/:id/results",
  requireAuth,
  requireRole(ROLES.LAB_TECH),
  validateBody(EnterResultsSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const { order, writes } = await enterResults(req.params.id, req.session.user!.id, req.body);

      for (const write of writes) {
        const item = order.items.find((i) => i.id === write.itemId);
        await recordAudit({
          userId: req.session.user!.id,
          action: write.wasCreate ? "lab_result.create" : "lab_result.update",
          entity: "laboratory_order_items",
          entityId: write.itemId,
          afterValue: item ? { result: item.result } : null,
          ipAddress: req.ip,
        });
      }

      res.json({ data: { order }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// AT_LAB -> LAB_COMPLETED via the existing transitionVisit(), only
// once every requested item has a result.
laboratoryRouter.post(
  "/orders/:id/complete",
  requireAuth,
  requireRole(ROLES.LAB_TECH),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const order = await completeLabOrder(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "lab_order.complete",
        entity: "laboratory_orders",
        entityId: req.params.id,
        afterValue: { visitStatus: order.visitStatus },
        ipAddress: req.ip,
      });
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: order.visitId,
        beforeValue: { status: "AT_LAB" },
        afterValue: { status: "LAB_COMPLETED", reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { order }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);