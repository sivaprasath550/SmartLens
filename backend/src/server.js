import http from 'node:http';
import os from 'node:os';
import { describeConfig, loadConfig } from './config/env.js';
import { initStore } from './config/database.js';
import { createApp } from './app.js';
import { createRealtime } from './sockets/realtime.js';
import { logger, setLogLevel } from './utils/logger.js';

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  setLogLevel(config.logLevel);
  logger.info('Starting SmartLens backend', describeConfig(config));

  const store = await initStore(config);
  const httpServer = http.createServer();
  const realtime = createRealtime(httpServer, config);
  const app = createApp({ config, store, realtime });
  httpServer.on('request', app);

  const { sessionService, demoSimulator, placesService } = app.locals.ctx;
  if (placesService.provider === 'demo') {
    logger.warn('DEMO MODE: nearby places are SIMULATED (set GOOGLE_PLACES_API_KEY for live results)');
  } else if (placesService.provider === 'none') {
    logger.warn('Nearby-place search is disabled (no GOOGLE_PLACES_API_KEY and DEMO_MODE=false)');
  } else {
    logger.info('Nearby places: Google Places API (New)');
  }

  const sweeper = setInterval(() => {
    sessionService.expireStaleSessions().catch((error) => logger.warn(`session sweep failed: ${error.message}`));
  }, 15000);
  sweeper.unref();

  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') logger.error(`Port ${config.port} is already in use`);
    else logger.error(`HTTP server error: ${error.message}`);
    process.exit(1);
  });

  httpServer.listen(config.port, config.host, () => {
    logger.info(`SmartLens API listening on http://${config.host}:${config.port}`);
    logger.info(`  This computer:     http://localhost:${config.port}/api/health`);
    logger.info(`  Android emulator:  http://10.0.2.2:${config.port}/`);
    if (config.host === '0.0.0.0') {
      for (const address of lanAddresses()) logger.info(`  Same Wi-Fi phone:  http://${address}:${config.port}/`);
    }
    logger.info(`  Storage: ${store.kind}${store.persistent ? '' : ' (TEMPORARY - data is lost on restart)'}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);
    clearInterval(sweeper);
    await demoSimulator.shutdown().catch(() => {});
    await realtime.close().catch(() => {});
    httpServer.close();
    await store.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error(`Fatal startup error: ${error.message}`);
  process.exit(1);
});
