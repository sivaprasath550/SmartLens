import mongoose from 'mongoose';

const lastLocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    accuracy: { type: Number, default: null },
    source: { type: String, enum: ['gps', 'network', 'demo'], default: 'gps' },
    clientTimestamp: { type: Date, default: null },
    receivedAt: { type: Date, required: true },
  },
  { _id: false },
);

/** A camera/location session started from the mobile app (or the demo simulator). */
const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    // Only a SHA-256 hash of the session write token is stored.
    tokenHash: { type: String, required: true, select: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    endedReason: { type: String, enum: ['user', 'timeout', 'simulation-complete', null], default: null },
    cameraActive: { type: Boolean, default: true },
    deviceName: { type: String, default: 'Android device', maxlength: 80 },
    platform: { type: String, default: 'android' },
    appVersion: { type: String, default: null },
    locationSource: { type: String, enum: ['gps', 'network', 'demo'], default: 'gps' },
    simulated: { type: Boolean, default: false },
    lastSeenAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    updateCount: { type: Number, default: 0 },
    lastLocation: { type: lastLocationSchema, default: null },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ lastSeenAt: -1 });
sessionSchema.index({ status: 1, lastSeenAt: -1 });

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
