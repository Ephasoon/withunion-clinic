import { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/appError";
import { logger } from "../config/logger";

/**
 * Single place all errors funnel through. Known AppErrors return
 * their intended status/code/message. Anything else is logged in
 * full server-side and returns a generic 500 to the client — no
 * stack traces, no raw DB error text, ever (Phase 1 §27 / §44).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, "AppError (5xx)");
    }
    return res.status(err.statusCode).json({
      data: null,
      error: { code: err.code, message: err.message, details: err.details ?? null },
      meta: null,
    });
  }

  logger.error({ err, path: req.path }, "Unhandled error");
  return res.status(500).json({
    data: null,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    meta: null,
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    data: null,
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
    meta: null,
  });
}
