import { ApiError } from '../utils/ApiError.js';
import { sendError } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound('ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/** Central error middleware: maps known errors to the standard error envelope. */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
    if (err.status >= 500) logger.warn(`${req.method} ${req.path} -> ${err.status} ${err.code}`);
    return sendError(req, res, err.status, err.code, err.message, err.details);
  }

  // body-parser errors
  if (err?.type === 'entity.too.large') {
    return sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err?.type === 'entity.parse.failed') {
    return sendError(req, res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') {
    return sendError(req, res, 415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
  }

  // mongoose / driver errors that indicate the database is unreachable
  if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError') {
    logger.error(`Database unavailable while handling ${req.method} ${req.path}`);
    return sendError(req, res, 503, 'DATABASE_UNAVAILABLE', 'Database is temporarily unavailable');
  }

  logger.error(`Unhandled error on ${req.method} ${req.path}: ${err?.message ?? err}`);
  if (err?.stack) logger.debug(err.stack);
  return sendError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}
