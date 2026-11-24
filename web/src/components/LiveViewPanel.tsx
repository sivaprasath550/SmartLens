import { useEffect, useRef, useState } from 'react';
import type { LatestData } from '../api/types';
import type { FrameListener, LiveFrame } from '../hooks/useDashboard';
import { formatAccuracy, formatCoordinate, formatRelative } from '../utils/format';
import { CameraIcon } from './Icons';

interface Props {
  latest: LatestData | null;
  subscribeFrames: (listener: FrameListener) => () => void;
  now: number;
}

/** No frame for this long means the phone stopped sharing (it sends ~15 per second). */
const STALE_AFTER_MS = 3000;
const STATS_INTERVAL_MS = 500;

interface Stats {
  receivedAt: string;
  bytes: number;
  fps: number;
  width: number;
  height: number;
}

/**
 * The dashboard's main element: the phone's opt-in live camera view.
 * Frames are drawn straight onto a canvas (decoded off the main thread by
 * createImageBitmap) without going through React state, so ~15 fps stays
 * smooth and does not re-render the rest of the dashboard. Only the small
 * stats line updates, twice a second.
 */
export function LiveViewPanel({ latest, subscribeFrames, now }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const session = latest?.session ?? null;
  const sessionId = session?.sessionId ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastBitmap: ImageBitmap | null = null;
    let lastRotation = 0;
    let drawnSeq = 0;
    let nextSeq = 0;
    let latestFrame: LiveFrame | null = null;
    let frameTimes: number[] = [];
    let cancelled = false;

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      if (!lastBitmap) return;
      // Frames arrive sensor-oriented; rotate while drawing ("contain" fit, letterboxed).
      const quarterTurn = lastRotation === 90 || lastRotation === 270;
      const uprightW = quarterTurn ? lastBitmap.height : lastBitmap.width;
      const uprightH = quarterTurn ? lastBitmap.width : lastBitmap.height;
      const scale = Math.min(w / uprightW, h / uprightH);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((lastRotation * Math.PI) / 180);
      const dw = lastBitmap.width * scale;
      const dh = lastBitmap.height * scale;
      ctx.drawImage(lastBitmap, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    };

    const unsubscribe = subscribeFrames((frame) => {
      if (!frame || frame.sessionId !== sessionId) {
        latestFrame = null;
        lastBitmap?.close();
        lastBitmap = null;
        frameTimes = [];
        paint();
        setStats(null);
        return;
      }
      latestFrame = frame;
      const seq = ++nextSeq;
      createImageBitmap(frame.blob)
        .then((bitmap) => {
          // Drop frames that finished decoding after a newer one.
          if (cancelled || seq < drawnSeq) {
            bitmap.close();
            return;
          }
          drawnSeq = seq;
          lastBitmap?.close();
          lastBitmap = bitmap;
          lastRotation = frame.rotation;
          frameTimes.push(performance.now());
          requestAnimationFrame(paint);
        })
        .catch(() => {
          /* corrupt frame: keep showing the previous one */
        });
    });

    const statsTimer = window.setInterval(() => {
      const cutoff = performance.now() - 2000;
      frameTimes = frameTimes.filter((t) => t >= cutoff);
      if (!latestFrame || !lastBitmap) return;
      setStats({
        receivedAt: latestFrame.receivedAt,
        bytes: latestFrame.bytes,
        fps: frameTimes.length / 2,
        width: lastRotation % 180 ? lastBitmap.height : lastBitmap.width,
        height: lastRotation % 180 ? lastBitmap.width : lastBitmap.height,
      });
    }, STATS_INTERVAL_MS);

    const resize = new ResizeObserver(() => paint());
    resize.observe(canvas);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(statsTimer);
      resize.disconnect();
      lastBitmap?.close();
    };
  }, [subscribeFrames, sessionId]);

  const ageMs = stats ? now - new Date(stats.receivedAt).getTime() : Infinity;
  const live = stats !== null && ageMs < STALE_AFTER_MS;
  const location = latest?.location ?? null;

  return (
    <section className="card panel live-panel" aria-label="Live camera view">
      <div className="panel-head">
        <h2>
          <CameraIcon /> Live camera view
          {session && <span className="muted small">· {session.deviceName}</span>}
        </h2>
        {stats && <span className={`chip ${live ? 'chip-live' : 'chip-muted'}`}>{live ? '● LIVE' : 'Paused'}</span>}
      </div>

      <div className={`live-stage ${stats && !live ? 'is-stale' : ''}`}>
        <canvas ref={canvasRef} aria-label={`Camera view from ${session?.deviceName ?? 'the phone'}`} role="img" />

        {stats && (
          <div className="live-hud">
            <span>{live ? `${stats.fps.toFixed(1)} fps` : 'paused'}</span>
            {location && (
              <span>
                {formatCoordinate(location.latitude, 'lat')} · {formatCoordinate(location.longitude, 'lng')}
              </span>
            )}
          </div>
        )}

        {!stats && (
          <div className="live-overlay">
            <CameraIcon size={34} />
            <p>
              {!session
                ? 'Waiting for the SmartLens app to start a camera session…'
                : session.status !== 'active'
                  ? 'The camera session has ended.'
                  : 'The phone is not sharing its camera. In SmartLens, turn on “Share live view with dashboard”.'}
            </p>
          </div>
        )}
        {stats && !live && (
          <div className="live-overlay is-stale-note">
            Live view paused — last frame {formatRelative(stats.receivedAt, now)}. The app may be in the background.
          </div>
        )}
      </div>

      <p className="muted small live-meta">
        {stats
          ? `${stats.width}×${stats.height} · ${Math.round(stats.bytes / 1024)} KB/frame · ${location ? formatAccuracy(location.accuracy) : 'no location'}`
          : 'Shared only while the phone user turns it on. Frames are relayed, never stored.'}
      </p>
    </section>
  );
}
