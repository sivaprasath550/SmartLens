import type { LatestData } from '../api/types';
import { formatDistance, formatRelative } from '../utils/format';
import { ExternalIcon, ListIcon } from './Icons';

interface Props {
  latest: LatestData | null;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string | null) => void;
  now: number;
}

export function PlacesPanel({ latest, selectedPlaceId, onSelectPlace, now }: Props) {
  const meta = latest?.places;
  const places = [...(latest?.nearbyPlaces ?? [])].sort(
    (a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity),
  );
  // Marker numbers follow the order the map received them in.
  const markerIndex = new Map((latest?.nearbyPlaces ?? []).map((p, i) => [p.id, i + 1]));

  return (
    <section className="card panel places-panel" aria-label="Nearby places">
      <div className="panel-head">
        <h2>
          <ListIcon /> Nearby places
        </h2>
        {meta && <span className="count">{places.length}</span>}
      </div>

      {meta && (
        <div className={`source-note ${meta.simulated ? 'is-demo' : ''}`}>
          {meta.simulated ? (
            <>
              <strong>Simulated demo data.</strong> These places are fictional and only illustrate the workflow.
            </>
          ) : (
            <>Live results · {meta.attribution}</>
          )}
          <span className="muted">
            {' '}
            · radius {meta.radius} m · {meta.category} · {formatRelative(meta.fetchedAt, now)}
          </span>
        </div>
      )}

      {!latest?.session && <p className="empty">No session yet. Start a camera session in the SmartLens app.</p>}
      {latest?.session && !meta && (
        <p className="empty">No nearby-place search for this session yet. Tap “Refresh places” in the app.</p>
      )}
      {meta && places.length === 0 && <p className="empty">No places found within {meta.radius} m.</p>}

      <ul className="place-list">
        {places.map((place) => (
          <li key={place.id}>
            <button
              type="button"
              className={`place-item ${place.id === selectedPlaceId ? 'is-selected' : ''}`}
              onClick={() => onSelectPlace(place.id === selectedPlaceId ? null : place.id)}
              aria-pressed={place.id === selectedPlaceId}
            >
              <span className={`place-num ${place.simulated ? 'is-demo' : ''}`}>{markerIndex.get(place.id)}</span>
              <span className="place-main">
                <span className="place-name">{place.name}</span>
                <span className="place-cat">{place.category}</span>
                {place.address && <span className="place-addr">{place.address}</span>}
              </span>
              <span className="place-side">
                <span className="place-dist">{formatDistance(place.distanceMeters)}</span>
                {place.mapsUri && (
                  <a
                    href={place.mapsUri}
                    target="_blank"
                    rel="noreferrer"
                    className="place-link"
                    onClick={(e) => e.stopPropagation()}
                    title={place.source === 'osm' ? 'Open in OpenStreetMap' : 'Open in Google Maps'}
                  >
                    <ExternalIcon size={14} />
                  </a>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
