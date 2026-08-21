/**
 * Augments Express's Request with a validatedQuery slot, populated
 * by middleware/validate.ts's validateQuery(). Using a separate
 * property (rather than overwriting req.query, which Express types
 * as ParsedQs) keeps this compatible with @types/express without
 * a cast at every call site beyond the initial middleware.
 */
declare namespace Express {
  interface Request {
    validatedQuery?: unknown;
  }
}
