import mongoose from 'mongoose';

/**
 * One accepted location report. Documents expire automatically after
 * LOCATION_RETENTION_HOURS (TTL index created in mongoStore.ensureIndexes)
 * so the database never accumulates an unbounded location history.
 */
const locationUpdateSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    accuracy: { type: Number, default: null },
    cameraActive: { type: Boolean, required: true },
    source: { type: String, enum: ['gps', 'network', 'demo'], default: 'gps' },
    clientTimestamp: { type: Date, default: null },
    receivedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

locationUpdateSchema.index({ sessionId: 1, receivedAt: -1 });

export const LocationUpdate =
  mongoose.models.LocationUpdate ?? mongoose.model('LocationUpdate', locationUpdateSchema);
