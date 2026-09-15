import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CreateUserSchema, UpdateUserSchema, ResetPasswordSchema } from "./users.schema";
import { listUsers, getUserById, createUser, updateUser, resetPassword } from "./users.service";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { ROLES } from "../roles/roles";

export const usersRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuidParam(value: string, label = "id") {
  if (!UUID_RE.test(value)) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid ${label} format`);
  }
}

// Existing endpoint, behavior unchanged -- DB logic moved into
// users.service.ts's listUsers(), matching every later module's
// service-layer convention.
usersRouter.get("/", requireAuth, requireRole(ROLES.OWNER), async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.json({ data: { users }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

usersRouter.get("/:id", requireAuth, requireRole(ROLES.OWNER), async (req, res, next) => {
  try {
    requireUuidParam(req.params.id);
    const user = await getUserById(req.params.id);
    if (!user) {
      throw new AppError(404, "NOT_FOUND", "User not found");
    }
    res.json({ data: { user }, error: null, meta: null });
  } catch (err) {
    next(err);
  }
});

usersRouter.post(
  "/",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(CreateUserSchema),
  async (req, res, next) => {
    try {
      const user = await createUser(req.body);
      await recordAudit({
        userId: req.session.user!.id,
        action: "user.create",
        entity: "users",
        entityId: user.id,
        afterValue: { fullName: user.fullName, username: user.username, role: user.role },
        ipAddress: req.ip,
      });
      res.status(201).json({ data: { user }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.patch(
  "/:id",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(UpdateUserSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const before = await getUserById(req.params.id);
      if (!before) {
        throw new AppError(404, "NOT_FOUND", "User not found");
      }

      const { user, wasDeactivated } = await updateUser(req.params.id, req.session.user!.id, req.body);

      // user.update always fires for any successful PATCH; user.deactivate
      // fires additionally, and specifically, when isActive just
      // transitioned true -> false -- a distinct, security-relevant
      // action worth its own audit entry per the approved scope, not a
      // replacement for the general update record.
      await recordAudit({
        userId: req.session.user!.id,
        action: "user.update",
        entity: "users",
        entityId: user.id,
        beforeValue: { fullName: before.fullName, role: before.role, isActive: before.isActive },
        afterValue: { fullName: user.fullName, role: user.role, isActive: user.isActive },
        ipAddress: req.ip,
      });
      if (wasDeactivated) {
        await recordAudit({
          userId: req.session.user!.id,
          action: "user.deactivate",
          entity: "users",
          entityId: user.id,
          ipAddress: req.ip,
        });
      }

      res.json({ data: { user }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);

usersRouter.post(
  "/:id/reset-password",
  requireAuth,
  requireRole(ROLES.OWNER),
  validateBody(ResetPasswordSchema),
  async (req, res, next) => {
    try {
      requireUuidParam(req.params.id);
      const user = await resetPassword(req.params.id, req.body.newPassword);
      await recordAudit({
        userId: req.session.user!.id,
        action: "user.password_reset",
        entity: "users",
        entityId: user.id,
        ipAddress: req.ip,
      });
      res.json({ data: { user }, error: null, meta: null });
    } catch (err) {
      next(err);
    }
  }
);
