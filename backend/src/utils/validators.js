import { z } from 'zod';

export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 5000;
export const DEFAULT_RADIUS_M = 1000;

/**
 * App-level place categories mapped to Google Places (New) "Table A" types.
 * Using a fixed allow-list keeps requests valid and predictable.
 */
export const PLACE_CATEGORIES = Object.freeze({
  all: [],
  food: ['restaurant', 'fast_food_restaurant', 'bakery'],
  cafe: ['cafe', 'coffee_shop'],
  attractions: ['tourist_attraction', 'museum', 'park', 'art_gallery'],
  shopping: ['shopping_mall', 'supermarket', 'store'],
  transit: ['bus_station', 'train_station', 'transit_station', 'subway_station'],
  health: ['hospital', 'pharmacy', 'doctor'],
  education: ['university', 'school', 'library'],
  lodging: ['lodging', 'hotel'],
});

export const CATEGORY_KEYS = Object.keys(PLACE_CATEGORIES);

const finiteNumber = (label) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number`, required_error: `${label} is required` })
    .refine(Number.isFinite, `${label} must be a finite number`);

export const latitudeSchema = finiteNumber('latitude').pipe(
  z.number().min(-90, 'latitude must be between -90 and 90').max(90, 'latitude must be between -90 and 90'),
);

export const longitudeSchema = finiteNumber('longitude').pipe(
  z
    .number()
    .min(-180, 'longitude must be between -180 and 180')
    .max(180, 'longitude must be between -180 and 180'),
);

const sessionIdSchema = z
  .string({ required_error: 'sessionId is required', invalid_type_error: 'sessionId must be a string' })
  .trim()
  .min(1, 'sessionId is required')
  .max(64, 'sessionId is too long')
  .regex(/^[A-Za-z0-9_-]+$/, 'sessionId contains invalid characters');

const locationSourceSchema = z.enum(['gps', 'network', 'demo']);

/** Accepts ISO-8601 strings or epoch milliseconds; rejects far-future/past values. */
const clientTimestampSchema = z
  .union([z.string().datetime({ offset: true }), z.number().int().positive()])
  .transform((value, ctx) => {
    const date = new Date(value);
    const now = Date.now();
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'timestamp is not a valid date' });
      return z.NEVER;
    }
    if (date.getTime() > now + 5 * 60 * 1000 || date.getTime() < now - 7 * 24 * 3600 * 1000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'timestamp is outside the accepted range' });
      return z.NEVER;
    }
    return date;
  });

export const createSessionSchema = z
  .object({
    deviceName: z.string().trim().max(80).optional(),
    platform: z.enum(['android', 'ios', 'web', 'simulator']).optional().default('android'),
    locationSource: locationSourceSchema.optional().default('gps'),
    cameraActive: z.boolean().optional().default(true),
    appVersion: z.string().trim().max(32).optional(),
  })
  .strict();

export const locationUpdateSchema = z
  .object({
    sessionId: sessionIdSchema,
    latitude: z
      .number({ required_error: 'latitude is required', invalid_type_error: 'latitude must be a number' })
      .min(-90, 'latitude must be between -90 and 90')
      .max(90, 'latitude must be between -90 and 90'),
    longitude: z
      .number({ required_error: 'longitude is required', invalid_type_error: 'longitude must be a number' })
      .min(-180, 'longitude must be between -180 and 180')
      .max(180, 'longitude must be between -180 and 180'),
    accuracy: z.number().min(0).max(100000).nullable().optional(),
    cameraActive: z.boolean({
      required_error: 'cameraActive is required',
      invalid_type_error: 'cameraActive must be a boolean',
    }),
    timestamp: clientTimestampSchema.optional(),
    source: locationSourceSchema.optional().default('gps'),
  })
  .strict();

export const sessionIdParamSchema = z.object({ id: sessionIdSchema });

export const nearbyPlacesSchema = z
  .object({
    latitude: latitudeSchema,
    longitude: longitudeSchema,
    radius: z.coerce
      .number({ invalid_type_error: 'radius must be a number' })
      .int('radius must be an integer number of metres')
      .min(MIN_RADIUS_M, `radius must be at least ${MIN_RADIUS_M} m`)
      .max(MAX_RADIUS_M, `radius must be at most ${MAX_RADIUS_M} m`)
      .optional()
      .default(DEFAULT_RADIUS_M),
    category: z
      .enum(CATEGORY_KEYS, {
        errorMap: () => ({ message: `category must be one of: ${CATEGORY_KEYS.join(', ')}` }),
      })
      .optional()
      .default('all'),
    maxResults: z.coerce.number().int().min(1).max(20).optional().default(20),
    sessionId: sessionIdSchema.optional(),
  })
  .strict();

export const historyQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    sessionId: sessionIdSchema.optional(),
  })
  .strict();

export const latestQuerySchema = z.object({ sessionId: sessionIdSchema.optional() }).strict();

/** Converts zod issues into a compact list of { field, message } objects. */
export function formatZodIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.code === 'unrecognized_keys' ? `unknown field(s): ${issue.keys.join(', ')}` : issue.message,
  }));
}
