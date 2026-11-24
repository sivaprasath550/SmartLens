/** Types mirror the backend response envelope documented in docs/API.md. */

export type Mode = 'demo' | 'live';
export type LocationSource = 'gps' | 'network' | 'demo';

export interface ApiMeta {
  mode: Mode;
  storage: 'mongodb' | 'memory';
  updatedAt?: string | null;
  empty?: boolean;
  cached?: boolean;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; details?: { field: string; message: string }[] };
  meta?: Partial<ApiMeta>;
}

export interface LocationPoint {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  cameraActive: boolean;
  source: LocationSource;
  clientTimestamp: string | null;
  receivedAt: string | null;
}

export interface Session {
  sessionId: string;
  status: 'active' | 'inactive';
  endedReason: 'user' | 'timeout' | 'simulation-complete' | null;
  cameraActive: boolean;
  deviceName: string;
  platform: string;
  appVersion: string | null;
  locationSource: LocationSource;
  simulated: boolean;
  createdAt: string | null;
  lastSeenAt: string | null;
  endedAt: string | null;
  updateCount: number;
  lastLocation: LocationPoint | null;
}

export interface Place {
  id: string;
  name: string;
  category: string;
  types: string[];
  address: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  mapsUri: string | null;
  businessStatus: string | null;
  source: 'google' | 'osm' | 'demo';
  simulated: boolean;
}

export interface PlacesMeta {
  source: 'google' | 'osm' | 'demo';
  simulated: boolean;
  attribution: string | null;
  radius: number;
  category: string;
  center: { latitude: number; longitude: number };
  fetchedAt: string | null;
  count: number;
}

export interface LatestData {
  sessionId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
  cameraActive: boolean;
  status?: Session['status'];
  nearbyPlaces: Place[];
  session: Session | null;
  location: LocationPoint | null;
  places: PlacesMeta | null;
}

export interface HistorySessions {
  count: number;
  sessions: Session[];
}

export interface HistoryUpdates {
  sessionId: string;
  session: Session;
  count: number;
  updates: LocationPoint[];
}

export interface Health {
  status: string;
  serverTime: string;
  demoMode: boolean;
  database: { status: string; storage: 'mongodb' | 'memory'; persistent: boolean };
  places: { provider: 'google' | 'osm' | 'demo' | 'none'; configured: boolean; simulated: boolean };
  realtime: { connectedClients: number };
  dashboardProtected: boolean;
  locationUpdateIntervalSeconds: number;
  sessionTimeoutSeconds: number;
}

export interface SimulationStatus {
  available: boolean;
  running: boolean;
  sessionId?: string;
  step?: number;
  steps?: number;
}

/* Socket.IO event payloads */

export interface LocationUpdatedEvent {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: LocationSource;
  cameraActive: boolean;
  status: Session['status'];
  simulated: boolean;
  clientTimestamp: string | null;
  updatedAt: string;
  updateCount: number;
}

export interface PlacesUpdatedEvent {
  sessionId: string;
  center: { latitude: number; longitude: number };
  radius: number;
  category: string;
  source: 'google' | 'osm' | 'demo';
  simulated: boolean;
  attribution: string | null;
  places: Place[];
  fetchedAt: string;
  count: number;
  updatedAt: string;
}

export interface SessionUpdatedEvent {
  change: 'created' | 'stopped' | 'timeout' | 'resumed';
  session: Session;
  serverTime: string;
}

/** Opt-in live view: one JPEG camera frame relayed from the phone. */
export interface CameraFrameEvent {
  sessionId: string;
  image: ArrayBuffer;
  mimeType: string;
  bytes: number;
  /** Clockwise rotation (0/90/180/270) to apply when drawing. */
  rotation: number;
  receivedAt: string;
}
