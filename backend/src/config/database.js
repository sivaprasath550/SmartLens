import mongoose from 'mongoose';
import { createMemoryStore } from '../services/store/memoryStore.js';
import { createMongoStore } from '../services/store/mongoStore.js';
import { logger } from '../utils/logger.js';

/** Removes credentials from a MongoDB URI so it can be logged safely. */
export function redactMongoUri(uri) {
  return uri.replace(/\/\/([^@/]+)@/, '//***@');
}

/**
 * Connects to MongoDB and returns the persistent store. When the database is
 * not configured or not reachable, demo mode falls back to a clearly
 * labelled in-memory store; outside demo mode startup fails instead.
 */
export async function initStore(config) {
  const options = { locationRetentionHours: config.locationRetentionHours };

  if (!config.mongoUri) {
    if (!config.demoMode) {
      throw new Error('MONGODB_URI is required when DEMO_MODE=false');
    }
    logger.warn('MONGODB_URI not set: using TEMPORARY in-memory storage (data is lost on restart)');
    return createMemoryStore(options);
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 4000 });
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    const store = createMongoStore(options);
    await store.ensureIndexes();
    logger.info(`Connected to MongoDB at ${redactMongoUri(config.mongoUri)}`);
    return store;
  } catch (error) {
    await mongoose.disconnect().catch(() => {});
    if (!config.demoMode) {
      throw new Error(`Could not connect to MongoDB: ${error.message}`);
    }
    logger.warn(
      `MongoDB unreachable (${error.message}); demo mode is using TEMPORARY in-memory storage (data is lost on restart)`,
    );
    return createMemoryStore(options);
  }
}
