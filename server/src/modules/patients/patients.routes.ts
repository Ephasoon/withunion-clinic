import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody, validateQuery } from "../../middleware/validate";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  SearchPatientsQuerySchema,
  SearchPatientsQuery,
} from "./patients.schema";
import { createPatient, searchPatients, getPatientById, updatePatient } from "./patients.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

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

// Editing demographic/contact fields is reception-only, same as
// registration — clinical roles never modify patient identity data.
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
      res.json({ data: { patient: updated }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
