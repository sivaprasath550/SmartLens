import { haversineMeters, offsetCoordinate } from '../utils/geo.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { DEMO_ATTRIBUTION, getDemoPlaces } from './demoPlaces.js';

const PATH_RADIUS_M = 220;
const PLACES_RADIUS_M = 1000;
const REFRESH_PLACES_AFTER_M = 150;

/**
 * Demo-mode only: drives a clearly simulated session around a fictional loop
 * so the whole backend -> Socket.IO -> dashboard pipeline can be shown
 * without a phone. It goes through the same session service as real
 * devices, and every record it produces is flagged as simulated/demo.
 */
export function createDemoSimulator({ sessionService, config, steps = 36 }) {
  let running = null;

  async function stop(reason) {
    if (!running) return null;
    const { timer, sessionId } = running;
    clearInterval(timer);
    running = null;
    try {
      return await sessionService.stopSession(sessionId, null, { reason, trusted: true });
    } catch (error) {
      logger.warn(`demo simulator could not stop session: ${error.message}`);
      return null;
    }
  }

  return {
    status() {
      return running ? { running: true, sessionId: running.sessionId, step: running.step, steps } : { running: false };
    },

    async start({ intervalMs = config.locationUpdateIntervalSeconds * 1000 } = {}) {
      if (!config.demoMode) {
        throw ApiError.forbidden('The demo simulator is only available when DEMO_MODE=true');
      }
      if (running) {
        throw ApiError.conflict('SIMULATION_RUNNING', `A demo simulation is already running (${running.sessionId})`);
      }
      const { session } = await sessionService.createSession(
        { deviceName: 'Demo simulator', platform: 'simulator', locationSource: 'demo', cameraActive: true },
        { simulated: true },
      );
      const center = config.demoCenter;
      const state = { sessionId: session.sessionId, step: 0, lastPlacesAt: null, timer: null };
      running = state;

      const tick = async () => {
        if (running !== state) return;
        const bearing = (state.step / steps) * 360;
        const point = offsetCoordinate(center.latitude, center.longitude, PATH_RADIUS_M, bearing);
        try {
          await sessionService.recordLocation(
            {
              sessionId: state.sessionId,
              latitude: point.latitude,
              longitude: point.longitude,
              accuracy: 8 + (state.step % 5) * 2,
              cameraActive: true,
              source: 'demo',
              timestamp: new Date(),
            },
            null,
            { trusted: true },
          );
          const moved = state.lastPlacesAt
            ? haversineMeters(state.lastPlacesAt.latitude, state.lastPlacesAt.longitude, point.latitude, point.longitude)
            : Infinity;
          if (moved >= REFRESH_PLACES_AFTER_M) {
            state.lastPlacesAt = point;
            await sessionService.attachPlaces(state.sessionId, {
              center: point,
              radius: PLACES_RADIUS_M,
              category: 'all',
              places: getDemoPlaces({ ...point, radius: PLACES_RADIUS_M }),
              source: 'demo',
              simulated: true,
              attribution: DEMO_ATTRIBUTION,
              fetchedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          logger.warn(`demo simulator tick failed: ${error.message}`);
        }
        state.step += 1;
        if (state.step >= steps && running === state) await stop('simulation-complete');
      };

      await tick();
      state.timer = setInterval(tick, intervalMs);
      state.timer.unref?.();
      return { session: await sessionService.requireSession(state.sessionId), steps, intervalMs };
    },

    async stop() {
      if (!running) throw ApiError.notFound('SIMULATION_NOT_RUNNING', 'No demo simulation is running');
      return stop('user');
    },

    async shutdown() {
      await stop('user');
    },
  };
}
