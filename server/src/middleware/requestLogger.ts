import pinoHttp from "pino-http";
import { logger } from "../config/logger";

export const requestLogger = pinoHttp({
  logger,
  autoLogging: true,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  // Never log the request body by default — auth payloads contain
  // passwords. Individual routes can log specific safe fields.
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, id: req.id }),
  },
});
