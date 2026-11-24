import { useEffect, useState } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useNow } from './hooks/useNow';
import { Header } from './components/Header';
import { SummaryCards } from './components/SummaryCards';
import { MapView } from './components/MapView';
import { PlacesPanel } from './components/PlacesPanel';
import { SessionPanel } from './components/SessionPanel';
import { LiveViewPanel } from './components/LiveViewPanel';
import { AccessKeyForm } from './components/AccessKeyForm';
import { AlertIcon, RefreshIcon, TargetIcon } from './components/Icons';

export default function App() {
  const { state, subscribeFrames, followSessionId, followSession, retry, onAccessKeyChanged, startSimulation, stopSimulation } =
    useDashboard();
  const now = useNow(1000);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [recenterSignal, setRecenterSignal] = useState(0);
  const { latest } = state;

  // Clear a selection that no longer exists in the current result set.
  useEffect(() => {
    if (selectedPlaceId && !latest?.nearbyPlaces.some((p) => p.id === selectedPlaceId)) setSelectedPlaceId(null);
  }, [latest?.nearbyPlaces, selectedPlaceId]);

  const restOk = !state.error && !state.loading;
  const dataSimulated = Boolean(
    latest?.session?.simulated || latest?.location?.source === 'demo' || latest?.places?.simulated,
  );

  return (
    <div className="app">
      <Header
        socketState={state.socketState}
        restOk={restOk || (state.loading && !state.error)}
        dataSimulated={dataSimulated}
        health={state.health}
        lastSyncAt={state.lastSyncAt}
        now={now}
      />

      <main className="content">
        {(state.authRequired || state.socketState === 'unauthorized') && <AccessKeyForm onSubmit={onAccessKeyChanged} />}

        {state.error && !state.authRequired && (
          <div className="banner banner-error" role="alert">
            <AlertIcon />
            <div>
              <strong>Could not load dashboard data.</strong> {state.error}
              {latest && <span className="muted"> Showing the last data received.</span>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retry()}>
              <RefreshIcon size={14} /> Retry
            </button>
          </div>
        )}

        {dataSimulated && (
          <div className="banner banner-demo">
            <strong>Demo mode:</strong>&nbsp;some of the data shown is simulated
            {latest?.location?.source === 'demo' && ' (demo location)'}
            {latest?.places?.simulated && ' (fictional nearby places)'}. It does not represent a real device position or
            real businesses.
          </div>
        )}

        {state.loading && !latest ? (
          <div className="loading">
            <div className="spinner" />
            <p>Loading the latest SmartLens data…</p>
          </div>
        ) : (
          <>
            <SummaryCards latest={latest} now={now} />
            <div className="grid">
              <LiveViewPanel latest={latest} subscribeFrames={subscribeFrames} now={now} />
              <div className="map-col card panel">
                <div className="map-toolbar">
                  <h2>Location map</h2>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRecenterSignal((n) => n + 1)}
                    disabled={latest?.latitude == null}
                  >
                    <TargetIcon size={14} /> Recenter
                  </button>
                </div>
                <MapView
                  latest={latest}
                  trail={state.trail}
                  selectedPlaceId={selectedPlaceId}
                  onSelectPlace={setSelectedPlaceId}
                  recenterSignal={recenterSignal}
                />
                <p className="map-note muted small">
                  Places are found from GPS coordinates, not from the camera picture.
                </p>
              </div>
              <PlacesPanel latest={latest} selectedPlaceId={selectedPlaceId} onSelectPlace={setSelectedPlaceId} now={now} />
              <SessionPanel
                latest={latest}
                sessions={state.sessions}
                followSessionId={followSessionId}
                onFollow={followSession}
                health={state.health}
                simulation={state.simulation}
                onStartSimulation={startSimulation}
                onStopSimulation={stopSimulation}
                now={now}
              />
            </div>
          </>
        )}
      </main>

      <footer className="footer muted small">
        SmartLens prototype · map tiles &copy; OpenStreetMap contributors · intended for controlled demonstrations on a
        trusted network
      </footer>
    </div>
  );
}
