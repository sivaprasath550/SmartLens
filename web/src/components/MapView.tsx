import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { LatestData, Place } from '../api/types';
import { formatAccuracy, formatCoordinate, formatDistance, isValidCoordinate } from '../utils/format';
import { TargetIcon } from './Icons';

interface Props {
  latest: LatestData | null;
  trail: [number, number][];
  selectedPlaceId: string | null;
  onSelectPlace: (id: string | null) => void;
  recenterSignal: number;
}

// Neutral world view used only until real coordinates arrive. No marker is shown for it.
const WORLD_VIEW: L.LatLngTuple = [20, 0];

const deviceIcon = (simulated: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="device-marker ${simulated ? 'is-demo' : ''}"><span></span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });

const placeIcon = (index: number, selected: boolean, simulated: boolean) =>
  L.divIcon({
    className: '',
    html: `<div class="place-marker ${selected ? 'is-selected' : ''} ${simulated ? 'is-demo' : ''}"><span>${index + 1}</span></div>`,
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    popupAnchor: [0, -30],
  });

/** Fits the view to the device + places when the session or result set changes. */
function FitController({ points, fitKey }: { points: L.LatLngTuple[]; fitKey: string }) {
  const map = useMap();
  const lastKey = useRef<string>('');
  useEffect(() => {
    if (points.length === 0 || fitKey === lastKey.current) return;
    lastKey.current = fitKey;
    if (points.length === 1) map.setView(points[0], 16, { animate: true });
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 17, animate: true });
  }, [map, points, fitKey]);
  return null;
}

/** Keeps the device in view as it moves, without overriding the user's zoom. */
function FollowDevice({ position }: { position: L.LatLngTuple | null }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    const bounds = map.getBounds().pad(-0.15);
    if (!bounds.contains(position)) map.panTo(position, { animate: true });
  }, [map, position]);
  return null;
}

function FlyToSelected({ place }: { place: Place | null }) {
  const map = useMap();
  useEffect(() => {
    if (place) map.flyTo([place.latitude, place.longitude], Math.max(map.getZoom(), 17), { duration: 0.6 });
    // Fly only when the selection changes, not when distances are recomputed.
  }, [map, place?.id]);
  return null;
}

function PlacesAttribution({ text }: { text: string | null }) {
  const map = useMap();
  useEffect(() => {
    if (!text) return;
    map.attributionControl.addAttribution(text);
    return () => {
      map.attributionControl.removeAttribution(text);
    };
  }, [map, text]);
  return null;
}

function PlaceMarker({
  place,
  index,
  selected,
  onSelect,
}: {
  place: Place;
  index: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<L.Marker>(null);
  useEffect(() => {
    if (selected) ref.current?.openPopup();
  }, [selected]);
  return (
    <Marker
      ref={ref}
      position={[place.latitude, place.longitude]}
      icon={placeIcon(index, selected, place.simulated)}
      zIndexOffset={selected ? 1000 : 0}
      eventHandlers={{ click: () => onSelect(place.id) }}
    >
      <Popup>
        <div className="popup">
          <strong>{place.name}</strong>
          <div className="popup-cat">{place.category}</div>
          {place.address && <div>{place.address}</div>}
          <div>Distance: {formatDistance(place.distanceMeters)}</div>
          {place.simulated && <div className="popup-demo">Simulated demo place — not a real location</div>}
          {place.mapsUri && (
            <a href={place.mapsUri} target="_blank" rel="noreferrer">
              {place.source === 'osm' ? 'Open in OpenStreetMap' : 'Open in Google Maps'}
            </a>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

function RecenterOnSignal({ signal, points }: { signal: number; points: L.LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (signal === 0 || points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 17 });
    // Only react to explicit recenter requests.
  }, [signal]);
  return null;
}

export function MapView({ latest, trail, selectedPlaceId, onSelectPlace, recenterSignal }: Props) {
  const hasDevice = isValidCoordinate(latest?.latitude, latest?.longitude);
  const device: L.LatLngTuple | null = hasDevice ? [latest!.latitude as number, latest!.longitude as number] : null;
  const places = useMemo(
    () => (latest?.nearbyPlaces ?? []).filter((p) => isValidCoordinate(p.latitude, p.longitude)),
    [latest?.nearbyPlaces],
  );
  const selected = places.find((p) => p.id === selectedPlaceId) ?? null;
  const simulatedDevice = latest?.location?.source === 'demo';

  const fitPoints = useMemo<L.LatLngTuple[]>(
    () => [...(device ? [device] : []), ...places.map((p) => [p.latitude, p.longitude] as L.LatLngTuple)],
    [device?.[0], device?.[1], places],
  );
  const fitKey = `${latest?.sessionId ?? ''}|${latest?.places?.fetchedAt ?? ''}|${device ? 'd' : ''}`;
  const accuracy = latest?.location?.accuracy;

  return (
    <div className="map-wrap card">
      <MapContainer center={device ?? WORLD_VIEW} zoom={device ? 16 : 2} className="map" scrollWheelZoom worldCopyJump>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <PlacesAttribution text={latest?.places?.attribution ?? null} />
        <FitController points={fitPoints} fitKey={fitKey} />
        <FollowDevice position={device} />
        <FlyToSelected place={selected} />
        <RecenterOnSignal signal={recenterSignal} points={fitPoints} />

        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#2dd4bf', weight: 3, opacity: 0.7, dashArray: '6 6' }} />}

        {device && typeof accuracy === 'number' && accuracy > 0 && accuracy < 5000 && (
          <Circle center={device} radius={accuracy} pathOptions={{ color: '#6366f1', weight: 1, fillOpacity: 0.12 }} />
        )}

        {device && (
          <Marker position={device} icon={deviceIcon(simulatedDevice)} zIndexOffset={2000}>
            <Popup>
              <div className="popup">
                <strong>{latest?.session?.deviceName ?? 'Device'}</strong>
                <div>{formatCoordinate(device[0], 'lat')}</div>
                <div>{formatCoordinate(device[1], 'lng')}</div>
                <div>{formatAccuracy(accuracy)}</div>
                {simulatedDevice && <div className="popup-demo">Simulated demo location</div>}
              </div>
            </Popup>
          </Marker>
        )}

        {places.map((place, index) => (
          <PlaceMarker
            key={place.id}
            place={place}
            index={index}
            selected={place.id === selectedPlaceId}
            onSelect={onSelectPlace}
          />
        ))}
      </MapContainer>

      {!device && (
        <div className="map-overlay">
          <TargetIcon size={28} />
          <p>Waiting for a location from the SmartLens app…</p>
        </div>
      )}
    </div>
  );
}
