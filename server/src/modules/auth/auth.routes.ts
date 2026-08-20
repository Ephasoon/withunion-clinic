import { Router } from "express";
import rateLimit from "express-rate-limit";
import { attemptLogin } from "./auth.service";
import { LoginSchema } from "./auth.schema";
import { validateBody } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { AppError } from "../../utils/appError";
import { recordAudit } from "../../utils/audit";
import { env } from "../../config/env";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  max: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    data: null,
    error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." },
    meta: null,
  },
});

authRouter.post("/login", loginLimiter, validateBody(LoginSchema), async (req, res, next) => {
  try {
    const { username, password } = req.body as { username: string; password: string };
    const result = await attemptLogin(username, password);

    if (!result.ok) {
      // Deliberately identical response for "no such user", "wrong
      // password", and "inactive account" — do not help an attacker
      // enumerate valid usernames or account states.
      await recordAudit({
        userId: null,
        action: "login.failed",
        entity: "users",
        entityId: username,
        ipAddress: req.ip,
      });
      return next(new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password"));
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = result.user;
      req.session.save(async (saveErr) => {
        if (saveErr) return next(saveErr);
        await recordAudit({
          userId: result.user.id,
          action: "login.success",
          entity: "users",
          entityId: result.user.id,
          ipAddress: req.ip,
        });
        res.json({ data: { user: result.user }, error: null, meta: null });
      });
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", requireAuth, (req, res, next) => {
  const userId = req.session.user?.id ?? null;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(env.SESSION_COOKIE_NAME);
    void recordAudit({ userId, action: "logout", entity: "users", entityId: userId });
    res.json({ data: { loggedOut: true }, error: null, meta: null });
  });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ data: { user: req.session.user }, error: null, meta: null });
});
