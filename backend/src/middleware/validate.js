import { ApiError } from '../utils/ApiError.js';
import { formatZodIssues } from '../utils/validators.js';

/**
 * Validates `req[source]` against a zod schema and stores the parsed result
 * on `req.valid[source]`. Express 5 exposes `req.query` as a getter, so the
 * parsed values are not written back onto the request.
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const input = source === 'body' ? (req.body ?? {}) : req[source];
    if (source === 'body' && (typeof input !== 'object' || Array.isArray(input))) {
      return next(ApiError.badRequest('Request body must be a JSON object'));
    }
    const result = schema.safeParse(input);
    if (!result.success) {
      return next(ApiError.badRequest('Request validation failed', formatZodIssues(result.error)));
    }
    req.valid = { ...(req.valid ?? {}), [source]: result.data };
    return next();
  };
}
