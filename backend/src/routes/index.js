import express, { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { dashboardAuth } from '../middleware/dashboardAuth.js';
import {
  createSessionSchema,
  historyQuerySchema,
  latestQuerySchema,
  locationUpdateSchema,
  nearbyPlacesSchema,
  sessionIdParamSchema,
} from '../utils/validators.js';
import { getHealth } from '../controllers/healthController.js';
import { createSession, stopSession } from '../controllers/sessionController.js';
import { submitLocation } from '../controllers/locationController.js';
import { findNearby } from '../controllers/placesController.js';
import { getHistory, getLatest } from '../controllers/dashboardController.js';
import { getSimulationStatus, startSimulation, stopSimulation } from '../controllers/demoController.js';
import { getLatestFrame, uploadFrame } from '../controllers/frameController.js';

const MAX_FRAME_BYTES = '512kb';

export function createApiRouter(limiters) {
  const router = Router();

  router.get('/health', getHealth);

  // Mobile app (writes)
  router.post('/sessions', limiters.sessionCreate, validate(createSessionSchema), createSession);
  router.post('/sessions/:id/stop', validate(sessionIdParamSchema, 'params'), stopSession);
  router.post('/location', validate(locationUpdateSchema), submitLocation);
  // Opt-in live view (raw JPEG body)
  router.post(
    '/sessions/:id/frame',
    limiters.frames,
    express.raw({ type: 'image/jpeg', limit: MAX_FRAME_BYTES }),
    validate(sessionIdParamSchema, 'params'),
    uploadFrame,
  );

  // Nearby places
  router.post('/places/nearby', limiters.places, validate(nearbyPlacesSchema), findNearby);
  router.get('/places/nearby', limiters.places, validate(nearbyPlacesSchema, 'query'), findNearby);

  // Web dashboard (reads)
  router.get('/dashboard/latest', dashboardAuth, validate(latestQuerySchema, 'query'), getLatest);
  router.get('/dashboard/history', dashboardAuth, validate(historyQuerySchema, 'query'), getHistory);
  router.get('/sessions/:id/frame', dashboardAuth, validate(sessionIdParamSchema, 'params'), getLatestFrame);

  // Demo-mode simulator (driven from the dashboard)
  router.get('/demo/simulation', dashboardAuth, getSimulationStatus);
  router.post('/demo/simulation', dashboardAuth, startSimulation);
  router.delete('/demo/simulation', dashboardAuth, stopSimulation);

  return router;
}
