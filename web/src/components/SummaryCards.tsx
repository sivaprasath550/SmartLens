import type { ReactNode } from 'react';
import type { LatestData } from '../api/types';
import { formatAccuracy, formatClock, formatCoordinate, formatRelative } from '../utils/format';
import { CameraIcon, ClockIcon, CompassIcon, ListIcon, PinIcon } from './Icons';

interface CardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}

function Card({ icon, label, value, sub, tone = '' }: CardProps) {
  return (
    <div className={`card stat ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function cameraStatus(latest: LatestData | null): { text: string; sub: string; tone: string } {
  const session = latest?.session;
  if (!session) return { text: 'No session', sub: 'Waiting for the mobile app', tone: 'muted' };
  if (session.status === 'inactive') {
    const reason =
      session.endedReason === 'timeout'
        ? 'Timed out (no updates)'
        : session.endedReason === 'simulation-complete'
          ? 'Simulation finished'
          : 'Ended by user';
    return { text: 'Ended', sub: reason, tone: 'muted' };
  }
  return session.cameraActive
    ? { text: 'Camera active', sub: 'Session live', tone: 'ok' }
    : { text: 'Camera paused', sub: 'App in background', tone: 'warn' };
}

export function SummaryCards({ latest, now }: { latest: LatestData | null; now: number }) {
  const status = cameraStatus(latest);
  const location = latest?.location;
  const simulatedLocation = location?.source === 'demo';
  const updatedAt = location?.receivedAt ?? latest?.session?.lastSeenAt ?? null;

  return (
    <section className="summary" aria-label="Summary">
      <Card
        icon={<PinIcon />}
        label="Latitude"
        value={<span className="mono">{formatCoordinate(latest?.latitude, 'lat')}</span>}
        sub={
          location ? (
            <>
              {formatAccuracy(location.accuracy)}
              {simulatedLocation && <span className="tag tag-demo">simulated</span>}
            </>
          ) : (
            'No location yet'
          )
        }
      />
      <Card
        icon={<CompassIcon />}
        label="Longitude"
        value={<span className="mono">{formatCoordinate(latest?.longitude, 'lng')}</span>}
        sub={location ? `Source: ${location.source.toUpperCase()}` : 'No location yet'}
      />
      <Card
        icon={<ListIcon />}
        label="Nearby places"
        value={latest?.places ? latest.nearbyPlaces.length : '—'}
        sub={
          latest?.places ? (
            <>
              within {latest.places.radius} m
              {latest.places.simulated && <span className="tag tag-demo">simulated</span>}
            </>
          ) : (
            'No search yet'
          )
        }
      />
      <Card icon={<CameraIcon />} label="Camera session" value={status.text} sub={status.sub} tone={`tone-${status.tone}`} />
      <Card
        icon={<ClockIcon />}
        label="Last update"
        value={updatedAt ? formatClock(updatedAt) : '—'}
        sub={updatedAt ? formatRelative(updatedAt, now) : 'Never'}
      />
    </section>
  );
}
