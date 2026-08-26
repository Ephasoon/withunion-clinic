import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { RecordVitalsSchema, RecordNursingAssessmentSchema } from "./nursing.schema";
import { recordVitals, listVitalsForVisit, recordNursingAssessmentAndAdvance } from "./nursing.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const nursingRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// Nurse-only, per the Phase 1 permission matrix (§3) — reception,
// doctor, lab, and pharmacy never write vitals or nursing notes.
nursingRouter.post(
  "/:id/vitals",
  requireAuth,
  requireRole(ROLES.NURSE),
  validateBody(RecordVitalsSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id, "visit id");
      const vitals = await recordVitals(req.params.id, req.session.user!.id, req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "vitals.record",
        entity: "vital_signs",
        entityId: vitals.id,
        afterValue: vitals,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { vitals }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Read access mirrors Patients/Visits: any authenticated clinical
// role can view, only nurse can write.
nursingRouter.get("/:id/vitals", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id, "visit id");
    const vitals = await listVitalsForVisit(req.params.id);
    res.json({ data: { vitals }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// Recording the assessment also advances the visit from WITH_NURSE
// to WAITING_FOR_DOCTOR via the existing transitionVisit() — this
// route does not decide or write visit status itself.
nursingRouter.post(
  "/:id/nursing-assessment",
  requireAuth,
  requireRole(ROLES.NURSE),
  validateBody(RecordNursingAssessmentSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id, "visit id");
      const beforeStatus = "WITH_NURSE"; // enforced precondition inside the service
      const { assessment, visitStatus } = await recordNursingAssessmentAndAdvance(
        req.params.id,
        req.session.user!.id,
        req.body
      );

      await recordAudit({
        userId: req.session.user!.id,
        action: "nursing_assessment.record",
        entity: "nursing_assessments",
        entityId: assessment.id,
        afterValue: assessment,
        ipAddress: req.ip,
      });

      // transitionVisit() (Visits module) only writes the queue_events
      // ledger row itself — the "visit.transition" audit_logs entry is
      // written by whichever route calls it, same as visits.routes.ts
      // does for the direct transition endpoint. Mirrored here so the
      // nurse-triggered handoff is audited identically either way.
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: req.params.id,
        beforeValue: { status: beforeStatus },
        afterValue: { status: visitStatus, reason: null },
        ipAddress: req.ip,
      });

      res.status(201).json({ data: { assessment, visitStatus }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
