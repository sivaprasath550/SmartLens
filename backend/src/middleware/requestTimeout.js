import { sendError } from '../utils/response.js';

/**
 * Responds with 503 if a handler has not answered within `ms` milliseconds.
 * `ms` may be a function of the request for routes that wait on slow upstreams.
 */
export function requestTimeout(ms) {
  return (req, res, next) => {
    const limitMs = typeof ms === 'function' ? ms(req) : ms;
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        sendError(req, res, 503, 'REQUEST_TIMEOUT', 'The server took too long to respond');
      }
    }, limitMs);
    timer.unref?.();
    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}
