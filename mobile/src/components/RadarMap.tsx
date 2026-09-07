import { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";
import {
  MAX_NATIVE_TILE_ZOOM,
  radarTileUrl,
  type RadarFrame,
  type RadarIndex,
} from "@shared/radar";
import type { ScoredSegment } from "@shared/types";
import { buildRouteChunks, routeCoordinates } from "../lib/routeChunks";
import { theme } from "../theme";

interface RadarMapProps {
  segments: ScoredSegment[];
  radarIndex: RadarIndex | null;
  // Кадр радара на отображаемый момент; null — момент вне покрытия радара.
  radarFrame: RadarFrame | null;
  radarOpacity: number;
  riderPosition: { lat: number; lon: number; distanceKm: number } | null;
}

const EDGE_PADDING = { top: 140, right: 60, bottom: 260, left: 60 };

export function RadarMap({
  segments,
  radarIndex,
  radarFrame,
  radarOpacity,
  riderPosition,
}: RadarMapProps) {
  const mapRef = useRef<MapView>(null);
  const chunks = buildRouteChunks(segments);
  const coordinates = routeCoordinates(segments);

  // Подгоняем камеру только при смене геометрии маршрута: при перемотке времени
  // сегменты пересчитываются заново, и рефит сбрасывал бы ручной зум.
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  const routeKey = first
    ? `${coordinates.length}:${first.latitude},${first.longitude}:${last.latitude},${last.longitude}`
    : "";

  useEffect(() => {
    if (coordinates.length === 0) return;
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: EDGE_PADDING,
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      // Приглушённая подложка не спорит с цветами радара — так делают погодные приложения.
      mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
      showsPointsOfInterests={false}
      showsTraffic={false}
      toolbarEnabled={false}
    >
      {radarIndex && radarFrame && (
        <UrlTile
          // Смена ключа пересоздаёт оверлей — иначе кадр не перерисовывается.
          key={radarFrame.path}
          urlTemplate={radarTileUrl(radarIndex, radarFrame)}
          tileSize={512}
          // Бесплатный тайлкеш RainViewer отдаёт мозаику только до z=7,
          // выше нативный слой сам растягивает последний доступный уровень.
          maximumNativeZ={MAX_NATIVE_TILE_ZOOM}
          maximumZ={20}
          opacity={radarOpacity}
          zIndex={1}
        />
      )}

      {coordinates.length > 1 && (
        <Polyline
          coordinates={coordinates}
          strokeColor="rgba(10, 12, 16, 0.55)"
          strokeWidth={9}
          zIndex={2}
        />
      )}

      {chunks.map((chunk, i) => (
        <Polyline
          key={`chunk-${i}`}
          coordinates={chunk.coordinates}
          strokeColor={chunk.color}
          strokeWidth={5}
          zIndex={3}
        />
      ))}

      {first && (
        <Marker coordinate={first} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.endpoint, { backgroundColor: theme.start }]}>
            <Text style={styles.endpointLabel}>С</Text>
          </View>
        </Marker>
      )}

      {last && coordinates.length > 1 && (
        <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.endpoint, { backgroundColor: theme.finish }]}>
            <Text style={styles.endpointLabel}>Ф</Text>
          </View>
        </Marker>
      )}

      {riderPosition && (
        <Marker
          coordinate={{ latitude: riderPosition.lat, longitude: riderPosition.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={10}
        >
          <View style={styles.rider}>
            <View style={styles.riderDot} />
            <Text style={styles.riderLabel}>{riderPosition.distanceKm.toFixed(0)} км</Text>
          </View>
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  endpoint: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  endpointLabel: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  rider: {
    alignItems: "center",
  },
  riderDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.rider,
    borderWidth: 3,
    borderColor: "#fff",
  },
  riderLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: "#7a4a00",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: "hidden",
  },
});
