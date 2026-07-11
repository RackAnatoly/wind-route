import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ScoredSegment } from "../types";

interface MapViewProps {
  segments: ScoredSegment[];
}

function segmentColor(headwind: number, maxAbs: number): string {
  if (maxAbs === 0) return "#888888";
  const intensity = Math.min(Math.abs(headwind) / maxAbs, 1);
  const lightness = 75 - intensity * 40; // сильнее компонент -> темнее
  const hue = headwind > 0 ? 0 : 130; // красный = headwind, зелёный = tailwind
  return `hsl(${hue}, 70%, ${lightness}%)`;
}

function FitBounds({ segments }: { segments: ScoredSegment[] }) {
  const map = useMap();
  useEffect(() => {
    if (segments.length === 0) return;
    const bounds = L.latLngBounds(
      segments.flatMap((s) => [
        [s.start.lat, s.start.lon] as [number, number],
        [s.end.lat, s.end.lon] as [number, number],
      ]),
    );
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [segments, map]);
  return null;
}

export function MapView({ segments }: MapViewProps) {
  if (segments.length === 0) return null;

  const maxAbs = Math.max(
    ...segments.map((s) => Math.abs(s.headwindComponent)),
    0.001,
  );
  const center: [number, number] = [segments[0].start.lat, segments[0].start.lon];

  return (
    <MapContainer
      center={center}
      zoom={12}
      style={{ height: "500px", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds segments={segments} />
      {segments.map((segment, i) => (
        <Polyline
          key={i}
          positions={[
            [segment.start.lat, segment.start.lon],
            [segment.end.lat, segment.end.lon],
          ]}
          pathOptions={{
            color: segmentColor(segment.headwindComponent, maxAbs),
            weight: 5,
          }}
        >
          <Popup>
            <div>
              <div>
                Дистанция: {(segment.start.distanceFromStart / 1000).toFixed(1)}{" "}
                км
              </div>
              <div>
                Ветер: {segment.windSpeed.toFixed(1)} км/ч,{" "}
                {segment.windDirection.toFixed(0)}°
              </div>
              <div>Курс: {segment.bearing.toFixed(0)}°</div>
              <div>
                {segment.headwindComponent > 0 ? "Встречный" : "Попутный"}:{" "}
                {Math.abs(segment.headwindComponent).toFixed(1)} км/ч
              </div>
            </div>
          </Popup>
        </Polyline>
      ))}
    </MapContainer>
  );
}
