import 'dotenv/config';
import { z } from 'zod';
import { DEFAULT_OVERPASS_URLS } from '../services/osmPlacesClient.js';
import { resolvePlacesProvider } from '../services/placesService.js';

const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const booleanString = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `expected true/false, got "${value}"` });
      return z.NEVER;
    });

const intString = (defaultValue, min, max) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `expected an integer between ${min} and ${max}, got "${value}"`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const floatString = (defaultValue, min, max) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `expected a number between ${min} and ${max}, got "${value}"`,
        });
        return z.NEVER;
      }
      return parsed;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  HOST: z.string().optional().default('0.0.0.0'),
  PORT: intString(3000, 1, 65535),
  MONGODB_URI: z.string().optional().default(''),
  GOOGLE_PLACES_API_KEY: z.string().optional().default(''),
  CORS_ORIGINS: z.string().optional().default(''),
  DEMO_MODE: booleanString(true),
  LOCATION_UPDATE_INTERVAL_SECONDS: intString(5, 2, 300),
  SESSION_TIMEOUT_SECONDS: intString(120, 30, 86400),
  LOCATION_RETENTION_HOURS: intString(24, 1, 720),
  PLACES_CACHE_TTL_SECONDS: intString(300, 0, 3600),
  PLACES_TIMEOUT_MS: intString(8000, 1000, 30000),
  PLACES_PROVIDER: z.enum(['auto', 'google', 'osm', 'demo', 'none']).optional().default('auto'),
  OVERPASS_URL: z.string().optional().default(''),
  OSM_TIMEOUT_MS: intString(45000, 5000, 120000),
  DASHBOARD_ACCESS_KEY: z.string().optional().default(''),
  DEMO_CENTER_LAT: floatString(12.823, -90, 90),
  DEMO_CENTER_LNG: floatString(80.0444, -180, 180),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info'),
});

/**
 * Parses and validates environment variables. Throws a readable error when
 * a value is malformed so the server refuses to start with a bad config.
 * Secrets are never included in the returned summary.
 */
export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const overpassUrls = e.OVERPASS_URL.split(',')
    .map((url) => url.trim())
    .filter(Boolean);

  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    mongoUri: e.MONGODB_URI.trim(),
    googlePlacesApiKey: e.GOOGLE_PLACES_API_KEY.trim(),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_DEV_ORIGINS,
    corsOriginsConfigured: corsOrigins.length > 0,
    demoMode: e.DEMO_MODE,
    locationUpdateIntervalSeconds: e.LOCATION_UPDATE_INTERVAL_SECONDS,
    sessionTimeoutSeconds: e.SESSION_TIMEOUT_SECONDS,
    locationRetentionHours: e.LOCATION_RETENTION_HOURS,
    placesCacheTtlSeconds: e.PLACES_CACHE_TTL_SECONDS,
    placesTimeoutMs: e.PLACES_TIMEOUT_MS,
    placesProvider: e.PLACES_PROVIDER,
    overpassUrls: overpassUrls.length > 0 ? overpassUrls : DEFAULT_OVERPASS_URLS,
    osmTimeoutMs: e.OSM_TIMEOUT_MS,
    dashboardAccessKey: e.DASHBOARD_ACCESS_KEY.trim(),
    demoCenter: { latitude: e.DEMO_CENTER_LAT, longitude: e.DEMO_CENTER_LNG },
    logLevel: e.LOG_LEVEL,
  });
}

/** "live" when real place data can be served, otherwise "demo". */
export function placesMode(config) {
  return ['google', 'osm'].includes(resolvePlacesProvider(config)) ? 'live' : 'demo';
}

/** Non-secret configuration summary that is safe to log or return. */
export function describeConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    demoMode: config.demoMode,
    placesProvider: { google: 'google-places-new', osm: 'openstreetmap-overpass' }[resolvePlacesProvider(config)] ?? resolvePlacesProvider(config),
    mongoConfigured: Boolean(config.mongoUri),
    corsOrigins: config.corsOrigins,
    dashboardProtected: Boolean(config.dashboardAccessKey),
    locationUpdateIntervalSeconds: config.locationUpdateIntervalSeconds,
    sessionTimeoutSeconds: config.sessionTimeoutSeconds,
  };
}
