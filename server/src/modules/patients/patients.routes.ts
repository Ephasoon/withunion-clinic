import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  SearchPatientsQuerySchema,
  SearchPatientsQuery,
  PatientHistoryQuerySchema,
  PatientHistoryQuery,
} from "./patients.schema";
import { createPatient, searchPatients, getPatientById, updatePatient } from "./patients.service";
import { getPatientHistory } from "./patientHistory.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";
import { listVisitsForPatient } from "../visits/visits.service";
import { redactForRole } from "../pharmacy/pharmacy.routes";

export const patientsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(req: import("express").Request) {
  if (!UUID_RE.test(req.params.id)) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid id format");
  }
}

// Registration is reception-only per the permission matrix (§3) —
// reception is the operational front-of-house role; other clinical
// roles have view access only, enforced below on the read routes.
patientsRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  validateBody(CreatePatientSchema),
  async (req, res, next) => {
    try {
      const patient = await createPatient(req.body, req.session.user!.id);
      await recordAudit({
        userId: req.session.user!.id,
        action: "patient.create",
        entity: "patients",
        entityId: patient.id,
        afterValue: patient,
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { patient }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Read access: every authenticated clinical role can search/view —
// matches "view" in the Phase 1 permission matrix for all roles
// other than reception's full access.
patientsRouter.get(
  "/",
  requireAuth,
  validateQuery(SearchPatientsQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: SearchPatientsQuery }).validatedQuery;
      const patients = await searchPatients(query.search, query.limit);
      res.json({ data: { patients }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

patientsRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req);
    const patient = await getPatientById(req.params.id);
    if (!patient) {
      throw new AppError(404, "NOT_FOUND", "Patient not found");
    }
    res.json({ data: { patient }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// A patient's visit history: every visit, any status (including
// COMPLETED/CANCELLED), newest first. Any authenticated role, like
// GET /patients/:id and GET /visits/:id.
patientsRouter.get("/:id/visits", requireAuth, async (req, res, next) => {
  try {
    requireUuidParam(req);
    if (!(await getPatientById(req.params.id))) {
      throw new AppError(404, "NOT_FOUND", "Patient not found");
    }
    const visits = await listVisitsForPatient(req.params.id);
    res.json({ data: { visits }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

// A patient's full clinical history for the doctor's consultation page:
// every other visit (excludeVisitId = the current one), newest first,
// each with its consultations + diagnoses, prescriptions, lab orders +
// results and vitals. Doctor and owner only — narrower than the
// per-visit reads it aggregates (/visits/:id/consultations etc.), with
// prescriptions redacted per role exactly as /visits/:id/prescriptions.
patientsRouter.get(
  "/:id/history",
  requireAuth,
  requireRole(ROLES.DOCTOR, ROLES.OWNER),
  validateQuery(PatientHistoryQuerySchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req);
      if (!(await getPatientById(req.params.id))) {
        throw new AppError(404, "NOT_FOUND", "Patient not found");
      }
      const query = (req as unknown as { validatedQuery: PatientHistoryQuery }).validatedQuery;
      const role = req.session.user!.role;
      const visits = (await getPatientHistory(req.params.id, query.excludeVisitId)).map((visit) => ({
        ...visit,
        prescriptions: visit.prescriptions.map((p) => redactForRole(p, role)),
      }));
      res.json({ data: { visits }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

// Editing demographic/contact fields is reception-only, same as
// registration — clinical roles never modify patient identity data.
// Also deactivates/reactivates via status (there is no delete). A
// status change additionally records patient.deactivate or
// patient.reactivate, its own distinct audit action, following the
// Suppliers/Users *.deactivate precedent, alongside the general
// patient.update entry.
patientsRouter.patch(
  "/:id",
  requireAuth,
  requireRole(ROLES.RECEPTION),
  validateBody(UpdatePatientSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req);
      const before = await getPatientById(req.params.id);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "Patient not found");
      }
      const updated = await updatePatient(req.params.id, req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "patient.update",
        entity: "patients",
        entityId: req.params.id,
        beforeValue: before,
        afterValue: updated,
        ipAddress: req.ip,
      });
      if (before.status === "active" && updated?.status === "inactive") {
        await recordAudit({
          userId: req.session.user!.id,
          action: "patient.deactivate",
          entity: "patients",
          entityId: req.params.id,
          ipAddress: req.ip,
        });
      } else if (before.status === "inactive" && updated?.status === "active") {
        await recordAudit({
          userId: req.session.user!.id,
          action: "patient.reactivate",
          entity: "patients",
          entityId: req.params.id,
          ipAddress: req.ip,
        });
      }
      res.json({ data: { patient: updated }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
