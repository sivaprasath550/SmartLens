import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, ApiRequestError, fetchLatestFrame, getDashboardKey, POLL_INTERVAL_MS, SOCKET_URL } from '../api/client';
import type {
  ApiMeta,
  CameraFrameEvent,
  Health,
  LatestData,
  LocationUpdatedEvent,
  Place,
  PlacesUpdatedEvent,
  Session,
  SessionUpdatedEvent,
  SimulationStatus,
} from '../api/types';
import { haversineMeters, isValidCoordinate } from '../utils/format';

/** One frame of the phone's opt-in live camera view. */
export interface LiveFrame {
  sessionId: string;
  blob: Blob;
  receivedAt: string;
  bytes: number;
  rotation: number;
}

export type FrameListener = (frame: LiveFrame | null) => void;

export type SocketState = 'connecting' | 'connected' | 'disconnected' | 'unauthorized';

const MAX_TRAIL_POINTS = 200;
const SAFETY_REFRESH_MS = 60000;

export interface DashboardState {
  latest: LatestData | null;
  meta: ApiMeta | null;
  sessions: Session[];
  trail: [number, number][];
  health: Health | null;
  simulation: SimulationStatus | null;
  loading: boolean;
  error: string | null;
  authRequired: boolean;
  socketState: SocketState;
  lastSyncAt: string | null;
}

type Action =
  | { type: 'latest'; latest: LatestData; meta: ApiMeta }
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'trail'; sessionId: string; points: [number, number][] }
  | { type: 'health'; health: Health }
  | { type: 'simulation'; simulation: SimulationStatus }
  | { type: 'restError'; message: string; auth: boolean }
  | { type: 'socket'; socketState: SocketState }
  | { type: 'location'; event: LocationUpdatedEvent }
  | { type: 'places'; event: PlacesUpdatedEvent }
  | { type: 'session'; event: SessionUpdatedEvent };

const initialState: DashboardState = {
  latest: null,
  meta: null,
  sessions: [],
  trail: [],
  health: null,
  simulation: null,
  loading: true,
  error: null,
  authRequired: false,
  socketState: 'connecting',
  lastSyncAt: null,
};

function withDistances(places: Place[], lat: number | null, lng: number | null): Place[] {
  if (!isValidCoordinate(lat, lng)) return places;
  return places.map((place) => ({
    ...place,
    distanceMeters: Math.round(haversineMeters(lat, lng as number, place.latitude, place.longitude)),
  }));
}

function upsertSession(list: Session[], session: Session): Session[] {
  const rest = list.filter((item) => item.sessionId !== session.sessionId);
  return [session, ...rest].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '')).slice(0, 20);
}

function reducer(state: DashboardState, action: Action): DashboardState {
  const now = new Date().toISOString();
  switch (action.type) {
    case 'latest': {
      const sameSession = state.latest?.sessionId === action.latest.sessionId;
      return {
        ...state,
        latest: action.latest,
        meta: action.meta,
        trail: sameSession ? state.trail : [],
        loading: false,
        error: null,
        authRequired: false,
        lastSyncAt: now,
      };
    }
    case 'sessions':
      return { ...state, sessions: action.sessions };
    case 'trail':
      if (state.latest?.sessionId !== action.sessionId) return state;
      return { ...state, trail: action.points };
    case 'health':
      return { ...state, health: action.health };
    case 'simulation':
      return { ...state, simulation: action.simulation };
    case 'restError':
      return { ...state, loading: false, error: action.message, authRequired: action.auth };
    case 'socket':
      return { ...state, socketState: action.socketState };
    case 'location': {
      const { event } = action;
      const latest = state.latest;
      if (!latest || latest.sessionId !== event.sessionId || !latest.session) return state;
      const location = {
        sessionId: event.sessionId,
        latitude: event.latitude,
        longitude: event.longitude,
        accuracy: event.accuracy,
        cameraActive: event.cameraActive,
        source: event.source,
        clientTimestamp: event.clientTimestamp,
        receivedAt: event.updatedAt,
      };
      const trail = [...state.trail, [event.latitude, event.longitude] as [number, number]].slice(-MAX_TRAIL_POINTS);
      const session: Session = {
        ...latest.session,
        status: event.status,
        cameraActive: event.cameraActive,
        lastSeenAt: event.updatedAt,
        updateCount: event.updateCount,
        lastLocation: location,
        endedAt: event.status === 'active' ? null : latest.session.endedAt,
        endedReason: event.status === 'active' ? null : latest.session.endedReason,
      };
      return {
        ...state,
        latest: {
          ...latest,
          latitude: event.latitude,
          longitude: event.longitude,
          accuracy: event.accuracy,
          cameraActive: event.cameraActive,
          status: event.status,
          location,
          session,
          nearbyPlaces: withDistances(latest.nearbyPlaces, event.latitude, event.longitude),
        },
        sessions: upsertSession(state.sessions, session),
        trail,
        lastSyncAt: now,
      };
    }
    case 'places': {
      const { event } = action;
      const latest = state.latest;
      if (!latest || latest.sessionId !== event.sessionId) return state;
      return {
        ...state,
        latest: {
          ...latest,
          nearbyPlaces: withDistances(event.places, latest.latitude, latest.longitude),
          places: {
            source: event.source,
            simulated: event.simulated,
            attribution: event.attribution,
            radius: event.radius,
            category: event.category,
            center: event.center,
            fetchedAt: event.fetchedAt,
            count: event.count,
          },
        },
        lastSyncAt: now,
      };
    }
    case 'session': {
      const { session } = action.event;
      const sessions = upsertSession(state.sessions, session);
      const latest = state.latest;
      if (!latest || latest.sessionId !== session.sessionId) return { ...state, sessions, lastSyncAt: now };
      return {
        ...state,
        sessions,
        latest: { ...latest, session, status: session.status, cameraActive: session.cameraActive },
        lastSyncAt: now,
      };
    }
    default:
      return state;
  }
}

function describeError(error: unknown): { message: string; auth: boolean } {
  if (error instanceof ApiRequestError) return { message: error.message, auth: error.isAuthError };
  return { message: 'Unexpected error while loading dashboard data', auth: false };
}

/**
 * Loads the latest state over REST, then keeps it current via Socket.IO.
 * While the socket is down, REST polling takes over so the dashboard keeps
 * updating. `followSessionId === null` means "follow the latest session".
 */
export function useDashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [followSessionId, setFollowSessionId] = useState<string | null>(null);
  const [authVersion, setAuthVersion] = useState(0);

  const stateRef = useRef(state);
  stateRef.current = state;
  const followRef = useRef(followSessionId);
  followRef.current = followSessionId;
  const refetchTimer = useRef<number | undefined>(undefined);

  // Live view frames bypass React state: at ~15 fps a state update per frame
  // would re-render the whole dashboard (map included). Subscribers (the live
  // view canvas) receive frames directly; `null` means "no frame / cleared".
  const frameListeners = useRef(new Set<FrameListener>());
  const lastFrameRef = useRef<LiveFrame | null>(null);
  const publishFrame = useCallback((frame: LiveFrame | null) => {
    lastFrameRef.current = frame;
    frameListeners.current.forEach((listener) => listener(frame));
  }, []);
  const showFrame = useCallback(
    (sessionId: string, blob: Blob, receivedAt: string, rotation: number) =>
      publishFrame({ sessionId, blob, receivedAt, bytes: blob.size, rotation }),
    [publishFrame],
  );
  const clearFrame = useCallback(() => publishFrame(null), [publishFrame]);
  const subscribeFrames = useCallback((listener: FrameListener) => {
    frameListeners.current.add(listener);
    listener(lastFrameRef.current);
    return () => {
      frameListeners.current.delete(listener);
    };
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const { data, meta } = await api.latest(followRef.current);
      dispatch({ type: 'latest', latest: data, meta });
    } catch (error) {
      const { message, auth } = describeError(error);
      if (error instanceof ApiRequestError && error.code === 'SESSION_NOT_FOUND') {
        setFollowSessionId(null);
        return;
      }
      dispatch({ type: 'restError', message, auth });
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const { data } = await api.sessions(10);
      dispatch({ type: 'sessions', sessions: data.sessions });
    } catch {
      /* the latest-data request reports connectivity problems */
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const { data } = await api.health();
      dispatch({ type: 'health', health: data });
      if (data.demoMode) {
        const sim = await api.simulationStatus();
        dispatch({ type: 'simulation', simulation: sim.data });
      }
    } catch {
      /* reported through loadLatest */
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadLatest(), loadSessions(), loadHealth()]);
  }, [loadLatest, loadSessions, loadHealth]);

  /** Coalesces bursts of events into a single REST refetch. */
  const scheduleRefetch = useCallback(() => {
    window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(() => {
      void loadLatest();
      void loadSessions();
    }, 300);
  }, [loadLatest, loadSessions]);

  // Initial load, and reload whenever the followed session or access key changes.
  useEffect(() => {
    void refreshAll();
  }, [refreshAll, followSessionId, authVersion]);

  // Location trail for the session currently shown.
  const shownSessionId = state.latest?.sessionId ?? null;
  useEffect(() => {
    if (!shownSessionId) return;
    let cancelled = false;
    api
      .sessionUpdates(shownSessionId, 60)
      .then(({ data }) => {
        if (cancelled) return;
        const points = data.updates
          .filter((u) => isValidCoordinate(u.latitude, u.longitude))
          .map((u) => [u.latitude, u.longitude] as [number, number])
          .reverse();
        dispatch({ type: 'trail', sessionId: shownSessionId, points });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shownSessionId]);

  // Live view: drop the old session's frame and show the latest one, if the phone shares it.
  const loadFrame = useCallback(
    async (sessionId: string) => {
      const frame = await fetchLatestFrame(sessionId);
      if (frame && stateRef.current.latest?.sessionId === sessionId) showFrame(sessionId, frame.blob, frame.receivedAt, frame.rotation);
    },
    [showFrame],
  );
  useEffect(() => {
    clearFrame();
    if (shownSessionId) void loadFrame(shownSessionId);
  }, [shownSessionId, clearFrame, loadFrame]);

  // Socket.IO connection: one socket per access-key version, fully cleaned up.
  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 8000,
      auth: { dashboardKey: getDashboardKey() },
    });
    dispatch({ type: 'socket', socketState: 'connecting' });

    /** In auto-follow mode, switch to another session only if the shown one is not live. */
    const shouldSwitchTo = (sessionId: string) => {
      if (followRef.current) return false;
      const latest = stateRef.current.latest;
      return !latest?.sessionId || (latest.sessionId !== sessionId && latest.session?.status !== 'active');
    };

    const onConnect = () => {
      dispatch({ type: 'socket', socketState: 'connected' });
      // Resynchronise anything missed while disconnected.
      void loadLatest();
      void loadSessions();
    };
    const onDisconnect = () => dispatch({ type: 'socket', socketState: 'disconnected' });
    const onConnectError = (error: Error) => {
      if (error.message === 'UNAUTHORIZED') {
        dispatch({ type: 'socket', socketState: 'unauthorized' });
      } else {
        dispatch({ type: 'socket', socketState: 'disconnected' });
      }
    };
    const onReconnectAttempt = () => dispatch({ type: 'socket', socketState: 'connecting' });

    const onLocation = (event: LocationUpdatedEvent) => {
      if (stateRef.current.latest?.sessionId === event.sessionId) dispatch({ type: 'location', event });
      else if (shouldSwitchTo(event.sessionId)) scheduleRefetch();
    };
    const onPlaces = (event: PlacesUpdatedEvent) => {
      if (stateRef.current.latest?.sessionId === event.sessionId) dispatch({ type: 'places', event });
    };
    const onFrame = (event: CameraFrameEvent) => {
      if (stateRef.current.latest?.sessionId !== event.sessionId) return;
      showFrame(event.sessionId, new Blob([event.image], { type: event.mimeType }), event.receivedAt, event.rotation ?? 0);
    };
    const onSession = (event: SessionUpdatedEvent) => {
      dispatch({ type: 'session', event });
      if (event.session.status === 'inactive' && event.session.sessionId === stateRef.current.latest?.sessionId) {
        clearFrame();
      }
      if (event.change === 'created' && shouldSwitchTo(event.session.sessionId)) scheduleRefetch();
      if (stateRef.current.health?.demoMode) {
        api
          .simulationStatus()
          .then(({ data }) => dispatch({ type: 'simulation', simulation: data }))
          .catch(() => {});
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on('location:updated', onLocation);
    socket.on('places:updated', onPlaces);
    socket.on('session:updated', onSession);
    socket.on('camera:frame', onFrame);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('location:updated', onLocation);
      socket.off('places:updated', onPlaces);
      socket.off('session:updated', onSession);
      socket.off('camera:frame', onFrame);
      socket.disconnect();
      window.clearTimeout(refetchTimer.current);
    };
  }, [authVersion, loadLatest, loadSessions, scheduleRefetch, showFrame, clearFrame]);

  // REST polling fallback while the socket is not connected, plus a slow safety refresh.
  useEffect(() => {
    const live = state.socketState === 'connected';
    const interval = window.setInterval(
      () => {
        if (document.visibilityState === 'hidden' && live) return;
        void loadLatest();
        void loadSessions();
        const sessionId = stateRef.current.latest?.sessionId;
        if (!live && sessionId) void loadFrame(sessionId);
      },
      live ? SAFETY_REFRESH_MS : POLL_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, [state.socketState, loadLatest, loadSessions, loadFrame]);

  const startSimulation = useCallback(async () => {
    await api.startSimulation();
    setFollowSessionId(null);
    await refreshAll();
  }, [refreshAll]);

  const stopSimulation = useCallback(async () => {
    await api.stopSimulation();
    await refreshAll();
  }, [refreshAll]);

  return {
    state,
    subscribeFrames,
    followSessionId,
    followSession: setFollowSessionId,
    retry: refreshAll,
    onAccessKeyChanged: () => setAuthVersion((v) => v + 1),
    startSimulation,
    stopSimulation,
  };
}
