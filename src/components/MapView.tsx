import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Popup,
  Marker,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapView.css";
import type { ScoredSegment } from "../types";

interface MapViewProps {
  segments: ScoredSegment[];
}

const WIND_ARROW_COUNT = 7;
const PRECIPITATION_MIN_MM = 0.1;

function precipColor(precipitation: number, maxPrecipitation: number): string {
  if (maxPrecipitation <= 0) return "transparent";
  const intensity = Math.min(precipitation / maxPrecipitation, 1);
  return `rgba(30, 100, 220, ${(0.15 + intensity * 0.45).toFixed(2)})`;
}

function precipRadius(precipitation: number, maxPrecipitation: number): number {
  if (maxPrecipitation <= 0) return 0;
  const intensity = Math.min(precipitation / maxPrecipitation, 1);
  return 350 + intensity * 750; // метры
}

function segmentColor(headwind: number, maxAbs: number): string {
  if (maxAbs === 0) return "#888888";
  const intensity = Math.min(Math.abs(headwind) / maxAbs, 1);
  const lightness = 75 - intensity * 40; // сильнее компонент -> темнее
  const hue = headwind > 0 ? 0 : 130; // красный = headwind, зелёный = tailwind
  return `hsl(${hue}, 70%, ${lightness}%)`;
}

// windDirection — откуда дует ветер (метео-конвенция). Стрелка должна указывать
// туда, куда дует ветер, поэтому разворачиваем на 180°.
function windArrowIcon(direction: number, speed: number): L.DivIcon {
  const rotation = (direction + 180) % 360;
  return L.divIcon({
    className: "wind-arrow-icon",
    html: `
      <div class="wind-arrow" style="transform: rotate(${rotation}deg)">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <path d="M12 3 L12 19 M12 3 L6.5 9.5 M12 3 L17.5 9.5"
            stroke="#1a5fb4" stroke-width="2.5" fill="none"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="wind-arrow-label">${speed.toFixed(0)} км/ч</div>
    `,
    iconSize: [50, 44],
    iconAnchor: [25, 13],
  });
}

function endpointIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "endpoint-icon",
    html: `<div class="endpoint-marker" style="background:${color}">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Выбирает до `count` равномерно распределённых сегментов вдоль маршрута для отображения стрелок ветра.
function pickArrowSegments(
  segments: ScoredSegment[],
  count: number,
): ScoredSegment[] {
  if (segments.length <= count) return segments;
  const picked: ScoredSegment[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (segments.length - 1));
    picked.push(segments[idx]);
  }
  return picked;
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

function MapLegend({
  maxAbs,
  maxPrecipitation,
}: {
  maxAbs: number;
  maxPrecipitation: number;
}) {
  return (
    <div className="map-legend">
      <h4>Заливка маршрута</h4>
      <div className="legend-gradient" />
      <div className="legend-gradient-labels">
        <span>встречный {maxAbs.toFixed(0)} км/ч</span>
        <span>попутный {maxAbs.toFixed(0)} км/ч</span>
      </div>
      <div className="legend-arrow-row">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path
            d="M12 3 L12 19 M12 3 L6.5 9.5 M12 3 L17.5 9.5"
            stroke="#1a5fb4"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Стрелка — куда дует ветер, подпись — скорость</span>
      </div>
      {maxPrecipitation >= PRECIPITATION_MIN_MM && (
        <div className="legend-arrow-row">
          <span className="legend-dot legend-dot--precip" />
          <span>Синий круг — осадки, ярче = сильнее (до {maxPrecipitation.toFixed(1)} мм/ч)</span>
        </div>
      )}
      <div className="legend-endpoints-row">
        <span className="legend-dot" style={{ background: "#2e7d32" }} />
        <span>Старт</span>
        <span className="legend-dot" style={{ background: "#c62828" }} />
        <span>Финиш</span>
      </div>
    </div>
  );
}

export function MapView({ segments }: MapViewProps) {
  if (segments.length === 0) return null;

  const maxAbs = Math.max(
    ...segments.map((s) => Math.abs(s.headwindComponent)),
    0.001,
  );
  const maxPrecipitation = Math.max(...segments.map((s) => s.precipitation), 0);
  const center: [number, number] = [segments[0].start.lat, segments[0].start.lon];
  const arrowSegments = pickArrowSegments(segments, WIND_ARROW_COUNT);

  return (
    <div className="map-view">
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
                {segment.precipitation >= PRECIPITATION_MIN_MM && (
                  <div>Осадки: {segment.precipitation.toFixed(1)} мм/ч</div>
                )}
              </div>
            </Popup>
          </Polyline>
        ))}
        {arrowSegments.map((segment, i) => {
          const midLat = (segment.start.lat + segment.end.lat) / 2;
          const midLon = (segment.start.lon + segment.end.lon) / 2;
          return (
            <Marker
              key={`wind-${i}`}
              position={[midLat, midLon]}
              icon={windArrowIcon(segment.windDirection, segment.windSpeed)}
              interactive={false}
            />
          );
        })}
        {maxPrecipitation >= PRECIPITATION_MIN_MM &&
          arrowSegments.map((segment, i) => {
            if (segment.precipitation < PRECIPITATION_MIN_MM) return null;
            const midLat = (segment.start.lat + segment.end.lat) / 2;
            const midLon = (segment.start.lon + segment.end.lon) / 2;
            return (
              <Circle
                key={`precip-${i}`}
                center={[midLat, midLon]}
                radius={precipRadius(segment.precipitation, maxPrecipitation)}
                pathOptions={{
                  color: "transparent",
                  fillColor: precipColor(segment.precipitation, maxPrecipitation),
                  fillOpacity: 1,
                }}
              >
                <Popup>Осадки: {segment.precipitation.toFixed(1)} мм/ч</Popup>
              </Circle>
            );
          })}
        <Marker
          position={[segments[0].start.lat, segments[0].start.lon]}
          icon={endpointIcon("С", "#2e7d32")}
        >
          <Popup>Старт</Popup>
        </Marker>
        <Marker
          position={[
            segments[segments.length - 1].end.lat,
            segments[segments.length - 1].end.lon,
          ]}
          icon={endpointIcon("Ф", "#c62828")}
        >
          <Popup>Финиш</Popup>
        </Marker>
      </MapContainer>
      <MapLegend maxAbs={maxAbs} maxPrecipitation={maxPrecipitation} />
    </div>
  );
}
