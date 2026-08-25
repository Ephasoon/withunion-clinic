import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreateVisitSchema, TransitionVisitSchema } from "./visits.schema";
import { createVisit, getVisitById, getVisitHistory, listTodayVisits, transitionVisit } from "./visits.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const visitsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// Visit creation is reception-only, mirroring patient registration —
// reception is the front-of-house role that starts every visit.
visitsRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  validateBody(CreateVisitSchema),
  async (req, res, next) => {
    try {
      const visit = await createVisit(req.body.patientId, req.session.user!.id);
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.create",
        entity: "visits",
        entityId: visit.id,
        afterValue: visit,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { visit }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Today's queue — every role sees it, but the result set is scoped
// to what's relevant to their step (reception/owner see everything;
// see visits.service.ts listTodayVisits for the derivation).
visitsRouter.get("/today", requireAuth, async (req, res, next) => {
  try {
    const visits = await listTodayVisits(req.session.user!.role);
    res.json({ data: { visits }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

visitsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const visit = await getVisitById(req.params.id);
    if (!visit) {
      throw new AppError(404, "NOT_FOUND", "Visit not found");
    }
    const history = await getVisitHistory(req.params.id);
    res.json({ data: { visit, history }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// The single state-changing endpoint every stage of the workflow
// goes through. No requireRole here — legality of a given
// from→to move for the caller's role is decided dynamically by
// canTransition() inside transitionVisit(), since which roles may
// fire which transition varies by transition (Phase 1 §4.4).
visitsRouter.post(
  "/:id/transition",
  requireAuth,
  validateBody(TransitionVisitSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const before = await getVisitById(req.params.id);
      const { toStatus, reason } = req.body as { toStatus: string; reason?: string };

      const visit = await transitionVisit(
        req.params.id,
        req.session.user!.role,
        toStatus as never,
        reason,
        req.session.user!.id
      );

      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: req.params.id,
        beforeValue: before ? { status: before.status } : null,
        afterValue: { status: visit.status, reason: reason ?? null },
        ipAddress: req.ip,
      });

      res.json({ data: { visit }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
