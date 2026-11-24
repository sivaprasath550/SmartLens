import { sendSuccess } from '../utils/response.js';

const startedAt = new Date();

export function getHealth(req, res) {
  const { config, store, placesService, realtime } = req.app.locals.ctx;
  const database = store.kind === 'mongodb' ? store.status() : 'not-connected';
  sendSuccess(req, res, {
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
    serverTime: new Date().toISOString(),
    demoMode: config.demoMode,
    database: {
      status: database,
      storage: store.kind,
      persistent: store.persistent,
    },
    places: {
      provider: placesService.provider,
      configured: placesService.provider !== 'none',
      simulated: placesService.provider === 'demo',
    },
    realtime: { connectedClients: realtime.clientCount() },
    dashboardProtected: Boolean(config.dashboardAccessKey),
    locationUpdateIntervalSeconds: config.locationUpdateIntervalSeconds,
    sessionTimeoutSeconds: config.sessionTimeoutSeconds,
  });
}
