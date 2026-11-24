import { ApiError } from '../utils/ApiError.js';
import { safeEqual } from '../utils/ids.js';

/**
 * Optional shared-key protection for dashboard (read) endpoints. When
 * DASHBOARD_ACCESS_KEY is empty the dashboard is open, which is only
 * appropriate on a trusted local network for a controlled demonstration.
 */
export function dashboardAuth(req, _res, next) {
  const expected = req.app.locals.ctx.config.dashboardAccessKey;
  if (!expected) return next();
  const provided = req.get('x-dashboard-key');
  if (!provided) return next(ApiError.unauthorized('Dashboard access key required'));
  if (!safeEqual(provided, expected)) return next(ApiError.forbidden('Invalid dashboard access key'));
  return next();
}
