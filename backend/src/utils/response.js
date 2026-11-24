/**
 * Every response follows one envelope:
 *   success: { success: true,  data, meta }
 *   failure: { success: false, error: { code, message, details? }, meta }
 * `meta.mode` is "demo" when simulated data may appear and "live" otherwise.
 */
export function buildMeta(req, extra = {}) {
  const ctx = req.app.locals.ctx;
  return {
    mode: ctx.mode(),
    storage: ctx.store.kind,
    ...extra,
  };
}

export function sendSuccess(req, res, data, { status = 200, meta = {} } = {}) {
  res.status(status).json({ success: true, data, meta: buildMeta(req, meta) });
}

export function sendError(req, res, status, code, message, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  let meta;
  try {
    meta = buildMeta(req);
  } catch {
    meta = {};
  }
  res.status(status).json({ success: false, error, meta });
}
