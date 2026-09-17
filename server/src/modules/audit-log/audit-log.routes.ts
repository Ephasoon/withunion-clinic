import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateQuery } from "../../middleware/validate";
import { AuditLogQuerySchema, AuditLogQuery } from "./audit-log.schema";
import { listAuditLogs, getAuditLogById } from "./audit-log.service";
import { AppError } from "../../utils/appError";
import { ROLES } from "../roles/roles";

export const auditLogRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// Owner-only, per the approved scope. requireRole(), not
// requirePermission() — consistent with every module's default
// choice throughout this project, despite PERMISSIONS.VIEW_AUDIT_LOG
// existing unused since Phase 2.
//
// No recordAudit() call anywhere in this module — viewing the audit
// log is deliberately not itself audited, per the approved scope.
auditLogRouter.get(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateQuery(AuditLogQuerySchema),
  async (req, res, next) => {
    try {
      const query = (req as unknown as { validatedQuery: AuditLogQuery }).validatedQuery;
      const { logs, total } = await listAuditLogs({
        entity: query.entity,
        entityId: query.entityId,
        userId: query.userId,
        action: query.action,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        limit: query.limit,
        offset: query.offset,
      });
      res.json({
        data: { logs, total, limit: query.limit, offset: query.offset },
        error: null,
        meta: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

auditLogRouter.get("/:id", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const log = await getAuditLogById(req.params.id);
    if (!log) {
      throw new AppError(404, "NOT_FOUND", "Audit log entry not found");
    }
    res.json({ data: { log }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});
