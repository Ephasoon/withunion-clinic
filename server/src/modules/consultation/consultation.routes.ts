import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  UpdateConsultationNotesSchema,
  CreateDiagnosisSchema,
  CreateLabOrderSchema,
  CreatePrescriptionSchema,
} from "./consultation.schema";
import {
  openConsultation,
  getConsultationById,
  updateConsultationNotes,
  createDiagnosis,
  createLabOrder,
  createPrescription,
  completeConsultation,
  getDiagnosesForConsultation,
} from "./consultation.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";
import { getVisitById } from "../visits/visits.service";

export const consultationRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// Opening a consultation also fires the existing WAITING_FOR_DOCTOR ->
// WITH_DOCTOR transition (see consultation.service.ts) — mounted
// under /visits/:id, mirroring Nursing's sub-resource pattern.
consultationRouter.post(
  "/visits/:id/consultations",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id, "visit id");
      const beforeVisit = await getVisitById(req.params.id);
      const consultation = await openConsultation(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "consultation.open",
        entity: "consultations",
        entityId: consultation.id,
        afterValue: consultation,
        ipAddress: req.ip,
      });

      // A transition only actually fires when the visit was
      // WAITING_FOR_DOCTOR (see consultation.service.ts openConsultation) —
      // if it was already WITH_DOCTOR (review after lab), no transition
      // happened and nothing extra is logged here.
      if (beforeVisit?.status === "WAITING_FOR_DOCTOR") {
        await recordAudit({
          userId: req.session.user!.id,
          action: "visit.transition",
          entity: "visits",
          entityId: req.params.id,
          beforeValue: { status: "WAITING_FOR_DOCTOR" },
          afterValue: { status: "WITH_DOCTOR", reason: null },
          ipAddress: req.ip,
        });
      }

      res.status(201).json({ data: { consultation }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

consultationRouter.get("/consultations/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const consultation = await getConsultationById(req.params.id);
    if (!consultation) {
      throw new AppError(404, "NOT_FOUND", "Consultation not found");
    }
    const diagnoses = await getDiagnosesForConsultation(req.params.id);
    res.json({ data: { consultation, diagnoses }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// "Own record only" — enforced inside updateConsultationNotes().
consultationRouter.patch(
  "/consultations/:id",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  validateBody(UpdateConsultationNotesSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const consultation = await updateConsultationNotes(req.params.id, req.session.user!.id, req.body.notes);
      await recordAudit({
        userId: req.session.user!.id,
        action: "consultation.update_notes",
        entity: "consultations",
        entityId: req.params.id,
        afterValue: { notes: consultation.notes },
        ipAddress: req.ip,
      });
      res.json({ data: { consultation }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

consultationRouter.post(
  "/consultations/:id/diagnoses",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  validateBody(CreateDiagnosisSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const diagnosis = await createDiagnosis(req.params.id, req.session.user!.id, req.body.description);
      await recordAudit({
        userId: req.session.user!.id,
        action: "diagnosis.create",
        entity: "diagnoses",
        entityId: diagnosis.id,
        afterValue: diagnosis,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { diagnosis }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Record-only — does not fulfill. See consultation.service.ts.
consultationRouter.post(
  "/consultations/:id/lab-orders",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  validateBody(CreateLabOrderSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const order = await createLabOrder(req.params.id, req.session.user!.id, req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "lab_order.create",
        entity: "laboratory_orders",
        entityId: order.id,
        afterValue: order,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { labOrder: order }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Record-only — does not dispense. See consultation.service.ts.
consultationRouter.post(
  "/consultations/:id/prescriptions",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  validateBody(CreatePrescriptionSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const prescription = await createPrescription(req.params.id, req.session.user!.id, req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "prescription.create",
        entity: "prescriptions",
        entityId: prescription.id,
        afterValue: prescription,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { prescription }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Chooses the visit's next status from what was actually created in
// this consultation, then fires that transition via the existing
// transitionVisit() (see consultation.service.ts completeConsultation).
consultationRouter.post(
  "/consultations/:id/complete",
  requireAuth,
  requireRole(ROLES.DOCTOR),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const before = await getConsultationById(req.params.id);
      const { consultation, visitStatus } = await completeConsultation(req.params.id, req.session.user!.id);

      await recordAudit({
        userId: req.session.user!.id,
        action: "consultation.complete",
        entity: "consultations",
        entityId: req.params.id,
        beforeValue: before ? { completedAt: before.completedAt } : null,
        afterValue: { completedAt: consultation.completedAt },
        ipAddress: req.ip,
      });
      await recordAudit({
        userId: req.session.user!.id,
        action: "visit.transition",
        entity: "visits",
        entityId: consultation.visitId,
        beforeValue: { status: "WITH_DOCTOR" },
        afterValue: { status: visitStatus, reason: null },
        ipAddress: req.ip,
      });

      res.json({ data: { consultation, visitStatus }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
