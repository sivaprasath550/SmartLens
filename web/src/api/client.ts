import type {
  ApiFailure,
  ApiMeta,
  ApiSuccess,
  Health,
  HistorySessions,
  HistoryUpdates,
  LatestData,
  SimulationStatus,
} from './types';

/** Empty string = same origin (the Vite dev server proxies /api to the backend). */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const SOCKET_URL = API_BASE_URL || window.location.origin;
export const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 5000;

const KEY_STORAGE = 'smartlens.dashboardKey';

export function getDashboardKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setDashboardKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable: key lives only for this page load */
  }
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }

  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 10000): Promise<{ data: T; meta: ApiMeta }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const key = getDashboardKey();
  if (key) headers.set('X-Dashboard-Key', key);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new ApiRequestError(
      0,
      aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      aborted ? 'The backend did not respond in time' : 'Cannot reach the SmartLens backend',
    );
  } finally {
    window.clearTimeout(timer);
  }

  let body: ApiSuccess<T> | ApiFailure | null = null;
  try {
    body = (await response.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    body = null;
  }

  if (!body || typeof body !== 'object' || !('success' in body)) {
    throw new ApiRequestError(response.status, 'BAD_RESPONSE', `Unexpected response from backend (HTTP ${response.status})`);
  }
  if (!body.success) {
    throw new ApiRequestError(response.status, body.error.code, body.error.message);
  }
  return { data: body.data, meta: body.meta };
}

/**
 * Latest live-view JPEG for a session, or null when the phone is not sharing
 * one (404). Used for the first paint and while the socket is down.
 */
export async function fetchLatestFrame(
  sessionId: string,
): Promise<{ blob: Blob; receivedAt: string; rotation: number } | null> {
  const headers = new Headers();
  const key = getDashboardKey();
  if (key) headers.set('X-Dashboard-Key', key);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/frame`, {
      headers,
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
  return {
    blob: await response.blob(),
    receivedAt: response.headers.get('x-frame-received-at') ?? new Date().toISOString(),
    rotation: Number(response.headers.get('x-frame-rotation')) || 0,
  };
}

export const api = {
  health: () => request<Health>('/api/health'),
  latest: (sessionId?: string | null) =>
    request<LatestData>(`/api/dashboard/latest${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  sessions: (limit = 10) => request<HistorySessions>(`/api/dashboard/history?limit=${limit}`),
  sessionUpdates: (sessionId: string, limit = 60) =>
    request<HistoryUpdates>(`/api/dashboard/history?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`),
  simulationStatus: () => request<SimulationStatus>('/api/demo/simulation'),
  startSimulation: () => request<{ sessionId: string }>('/api/demo/simulation', { method: 'POST' }),
  stopSimulation: () => request<{ sessionId: string | null }>('/api/demo/simulation', { method: 'DELETE' }),
};
