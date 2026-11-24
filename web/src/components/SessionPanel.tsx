import { useState } from 'react';
import type { Health, LatestData, Session, SimulationStatus } from '../api/types';
import { formatDateTime, formatRelative, shortId } from '../utils/format';
import { CopyIcon, PlayIcon, StopIcon } from './Icons';

interface Props {
  latest: LatestData | null;
  sessions: Session[];
  followSessionId: string | null;
  onFollow: (sessionId: string | null) => void;
  health: Health | null;
  simulation: SimulationStatus | null;
  onStartSimulation: () => Promise<void>;
  onStopSimulation: () => Promise<void>;
  now: number;
}

function StatusChip({ session }: { session: Session }) {
  if (session.status === 'active') {
    return <span className="chip chip-ok">{session.cameraActive ? 'Active' : 'Active · paused'}</span>;
  }
  return <span className="chip chip-muted">{session.endedReason === 'timeout' ? 'Timed out' : 'Inactive'}</span>;
}

export function SessionPanel({
  latest,
  sessions,
  followSessionId,
  onFollow,
  health,
  simulation,
  onStartSimulation,
  onStopSimulation,
  now,
}: Props) {
  const session = latest?.session ?? null;
  const [busy, setBusy] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const runSim = async (fn: () => Promise<void>) => {
    setBusy(true);
    setSimError(null);
    try {
      await fn();
    } catch (error) {
      setSimError(error instanceof Error ? error.message : 'Simulation request failed');
    } finally {
      setBusy(false);
    }
  };

  const copyId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.sessionId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (non-secure context) */
    }
  };

  return (
    <section className="card panel session-panel" aria-label="Session information">
      <div className="panel-head">
        <h2>Session</h2>
        {followSessionId ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onFollow(null)}>
            Follow latest
          </button>
        ) : (
          <span className="muted small">Following latest session</span>
        )}
      </div>

      {session ? (
        <dl className="kv">
          <dt>Session ID</dt>
          <dd>
            <code title={session.sessionId}>{session.sessionId}</code>
            <button type="button" className="icon-btn" onClick={copyId} title="Copy session ID">
              <CopyIcon size={14} />
            </button>
            {copied && <span className="muted small">copied</span>}
          </dd>
          <dt>Status</dt>
          <dd>
            <StatusChip session={session} />
            {session.simulated && <span className="tag tag-demo">simulator</span>}
          </dd>
          <dt>Device</dt>
          <dd>
            {session.deviceName} <span className="muted">({session.platform})</span>
          </dd>
          <dt>Started</dt>
          <dd>{formatDateTime(session.createdAt)}</dd>
          <dt>Last update</dt>
          <dd>
            {formatDateTime(session.lastSeenAt)} <span className="muted">({formatRelative(session.lastSeenAt, now)})</span>
          </dd>
          {session.endedAt && (
            <>
              <dt>Ended</dt>
              <dd>{formatDateTime(session.endedAt)}</dd>
            </>
          )}
          <dt>Updates</dt>
          <dd>{session.updateCount}</dd>
        </dl>
      ) : (
        <p className="empty">No sessions yet. Open the SmartLens app and tap “Start session”.</p>
      )}

      {health?.demoMode && (
        <div className="demo-box">
          <div>
            <strong>Demo simulator</strong>
            <p className="muted small">
              Drives a clearly labelled, simulated session around a fictional route — useful when no phone is available.
            </p>
          </div>
          {simulation?.running ? (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => runSim(onStopSimulation)}>
              <StopIcon size={16} /> Stop simulation ({simulation.step ?? 0}/{simulation.steps ?? 0})
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => runSim(onStartSimulation)}>
              <PlayIcon size={16} /> Run demo simulation
            </button>
          )}
          {simError && <p className="error-text small">{simError}</p>}
        </div>
      )}

      <h3 className="subhead">Recent sessions</h3>
      {sessions.length === 0 ? (
        <p className="empty small">No history yet.</p>
      ) : (
        <ul className="history">
          {sessions.map((item) => (
            <li key={item.sessionId}>
              <button
                type="button"
                className={`history-item ${item.sessionId === session?.sessionId ? 'is-current' : ''}`}
                onClick={() => onFollow(item.sessionId)}
                title="Show this session"
              >
                <span className={`status-dot ${item.status === 'active' ? 'on' : ''}`} />
                <span className="history-main">
                  <span className="mono">{shortId(item.sessionId)}</span>
                  <span className="muted small">
                    {item.deviceName}
                    {item.simulated ? ' · simulated' : ''}
                  </span>
                </span>
                <span className="muted small">{formatRelative(item.lastSeenAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
