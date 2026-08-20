import { NextFunction, Request, Response } from "express";
import { ZodSchema } from "zod";
import { AppError } from "../utils/appError";

/**
 * Validates req.body against a zod schema and replaces req.body with
 * the parsed (and coerced/defaulted) result. Rejects unknown fields
 * implicitly for any schema built with z.object({...}).strict(), and
 * otherwise strips them (zod's default) — every write endpoint in
 * this codebase should use a strict schema.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      return next(new AppError(400, "VALIDATION_ERROR", "Invalid request body", details));
    }
    req.body = result.data;
    next();
  };
}
