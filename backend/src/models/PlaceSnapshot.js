import mongoose from 'mongoose';

const placeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, default: 'Place' },
    types: { type: [String], default: [] },
    address: { type: String, default: null },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    distanceMeters: { type: Number, default: null },
    mapsUri: { type: String, default: null },
    businessStatus: { type: String, default: null },
    source: { type: String, enum: ['google', 'demo'], required: true },
    simulated: { type: Boolean, default: false },
  },
  { _id: false },
);

/**
 * The most recent nearby-place result for a session, kept so the dashboard
 * can show it after a reload. It is short-lived (TTL on `expiresAt`) because
 * Google Maps Platform terms only allow temporary caching of Places content.
 */
const placeSnapshotSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    center: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
    },
    radius: { type: Number, required: true },
    category: { type: String, default: 'all' },
    source: { type: String, enum: ['google', 'demo'], required: true },
    simulated: { type: Boolean, default: false },
    attribution: { type: String, default: null },
    places: { type: [placeSchema], default: [] },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

placeSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PlaceSnapshot =
  mongoose.models.PlaceSnapshot ?? mongoose.model('PlaceSnapshot', placeSnapshotSchema);
