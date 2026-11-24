import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createApiRouter } from './routes/index.js';
import { createLimiters } from './middleware/rateLimit.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createPlacesService } from './services/placesService.js';
import { createSessionService } from './services/sessionService.js';
import { createDemoSimulator } from './services/demoSimulator.js';
import { createNoopRealtime } from './sockets/realtime.js';
import { ApiError } from './utils/ApiError.js';
import { logger } from './utils/logger.js';

function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Path only: query strings and bodies can contain coordinates.
    logger.debug(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}

/**
 * Builds the Express app. Dependencies are injectable so tests can run the
 * full HTTP stack against an in-memory store and a fake Places client.
 */
export function createApp({ config, store, realtime = createNoopRealtime(), googleClient, osmClient, placesService, now }) {
  const app = express();
  const resolvedPlaces = placesService ?? createPlacesService({ config, googleClient, osmClient });
  const sessionService = createSessionService({ store, realtime, config, now });
  const demoSimulator = createDemoSimulator({ sessionService, config });

  const ctx = {
    config,
    store,
    realtime,
    placesService: resolvedPlaces,
    sessionService,
    demoSimulator,
    mode: () => (resolvedPlaces.provider === 'demo' ? 'demo' : 'live'),
  };
  app.locals.ctx = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Native mobile apps and curl send no Origin header.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new ApiError(403, 'CORS_REJECTED', `Origin ${origin} is not allowed`));
      },
      allowedHeaders: ['Content-Type', 'X-Session-Token', 'X-Dashboard-Key', 'X-Frame-Seq', 'X-Frame-Rotation'],
      exposedHeaders: ['X-Frame-Received-At', 'X-Frame-Rotation'],
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use(requestLogger);
  app.use(express.json({ limit: '16kb', strict: true }));

  const limiters = createLimiters();
  // Place searches may wait on a slow public OpenStreetMap server.
  const timeoutFor = (req) => (req.path.startsWith('/places/') ? Math.max(15000, config.osmTimeoutMs + 5000) : 15000);
  app.use('/api', limiters.api, requestTimeout(timeoutFor), createApiRouter(limiters));
  app.get('/', (_req, res) => {
    res.json({ name: 'SmartLens API', docs: '/api/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
