import type { Health } from '../api/types';
import type { SocketState } from '../hooks/useDashboard';
import { formatClock, formatRelative } from '../utils/format';
import { LogoMark } from './Icons';

interface Props {
  socketState: SocketState;
  restOk: boolean;
  dataSimulated: boolean;
  health: Health | null;
  lastSyncAt: string | null;
  now: number;
}

const SOCKET_LABEL: Record<SocketState, { text: string; tone: string; title: string }> = {
  connected: { text: 'Live', tone: 'ok', title: 'Real-time WebSocket connection established' },
  connecting: { text: 'Connecting…', tone: 'pending', title: 'Opening the real-time connection' },
  disconnected: { text: 'Polling', tone: 'warn', title: 'Real-time connection unavailable; refreshing over REST' },
  unauthorized: { text: 'Key required', tone: 'error', title: 'The backend requires a dashboard access key' },
};

export function Header({ socketState, restOk, dataSimulated, health, lastSyncAt, now }: Props) {
  // "Online" is only shown when the backend actually answered.
  const backend = !restOk
    ? { text: 'Backend offline', tone: 'error', title: 'The last REST request to the backend failed' }
    : socketState === 'disconnected'
      ? SOCKET_LABEL.disconnected
      : SOCKET_LABEL[socketState];

  return (
    <header className="header">
      <div className="brand">
        <LogoMark />
        <div>
          <div className="wordmark">
            Smart<span>Lens</span>
          </div>
          <h1>Live Location &amp; Nearby Places Dashboard</h1>
        </div>
      </div>
      <div className="header-status">
        <span className={`pill pill-${backend.tone}`} title={backend.title}>
          <span className="dot" />
          {backend.text}
        </span>
        {health && (
          <span
            className={`pill ${dataSimulated || health.places.simulated ? 'pill-demo' : 'pill-live'}`}
            title={
              health.places.simulated
                ? 'Nearby places are simulated (no Places API key on the server)'
                : health.places.provider === 'osm'
                  ? 'Nearby places come from OpenStreetMap (free, no API key)'
                  : 'Nearby places come from Google Places API'
            }
          >
            {dataSimulated || health.places.simulated ? 'DEMO · simulated data' : 'LIVE data'}
          </span>
        )}
        {health && !health.database.persistent && (
          <span className="pill pill-warn" title="MongoDB is not connected; data is held in temporary memory">
            Temporary storage
          </span>
        )}
        <span className="sync" title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Not synchronised yet'}>
          Last sync <strong>{lastSyncAt ? formatClock(lastSyncAt) : '—'}</strong>
          <em>{lastSyncAt ? formatRelative(lastSyncAt, now) : ''}</em>
        </span>
      </div>
    </header>
  );
}
