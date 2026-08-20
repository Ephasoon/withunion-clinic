import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError";
import { Permission, Role, roleHasPermission } from "../modules/roles/roles";

/**
 * Requires a logged-in session. Every protected route uses this
 * first — the frontend hiding a button is never sufficient on its
 * own (Phase 1 §27).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) {
    return next(new AppError(401, "UNAUTHENTICATED", "You must be logged in"));
  }
  next();
}

/**
 * Restricts a route to a specific set of roles. Use for coarse
 * checks like "owner only". For finer-grained checks tied to a
 * specific capability (e.g. COLLECT_PAYMENT), use requirePermission.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      return next(new AppError(401, "UNAUTHENTICATED", "You must be logged in"));
    }
    if (!allowed.includes(user.role)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have access to this resource"));
    }
    next();
  };
}

/**
 * Restricts a route to roles holding a specific permission, per the
 * ROLE_PERMISSIONS map in modules/roles/roles.ts. This is how the
 * "reception is the sole cashier" and "only owner adjusts inventory"
 * corrections are enforced server-side, not just documented.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      return next(new AppError(401, "UNAUTHENTICATED", "You must be logged in"));
    }
    if (!roleHasPermission(user.role, permission)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have access to this resource"));
    }
    next();
  };
}
