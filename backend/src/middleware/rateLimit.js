import { rateLimit } from 'express-rate-limit';
import { sendError } from '../utils/response.js';

function limiter({ windowMs, limit, message, skip }) {
  return rateLimit({
    windowMs,
    limit,
    skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      res.set('Retry-After', String(Math.ceil(options.windowMs / 1000)));
      sendError(req, res, 429, 'RATE_LIMITED', message);
    },
  });
}

/** Rate limiters are created per app instance so tests and servers never share counters. */
export function createLimiters() {
  return {
    // General API limit: generous enough for a dashboard plus a phone posting every few seconds.
    // Live-view frames have their own limit below.
    api: limiter({
      windowMs: 60 * 1000,
      limit: 300,
      message: 'Too many requests, please slow down',
      skip: (req) => req.method === 'POST' && /^\/sessions\/[^/]+\/frame$/.test(req.path),
    }),
    // Opt-in live view: about 15 frames/s from the phone, capped at 30/s.
    frames: limiter({ windowMs: 60 * 1000, limit: 1800, message: 'Too many live-view frames' }),
    // Nearby search can trigger a billed external call, so it is limited more tightly.
    places: limiter({
      windowMs: 60 * 1000,
      limit: 30,
      message: 'Too many nearby-place searches, please wait a moment',
    }),
    sessionCreate: limiter({
      windowMs: 60 * 1000,
      limit: 20,
      message: 'Too many sessions created, please wait a moment',
    }),
  };
}
