import { TileLayer } from "react-leaflet";
import {
  MAX_NATIVE_MAP_ZOOM,
  TILE_ZOOM_OFFSET,
  radarTileUrl,
  type RadarFrame,
  type RadarIndex,
} from "@shared/radar";

interface RadarLayerProps {
  index: RadarIndex;
  frame: RadarFrame;
  opacity: number;
}

// Тайлы радарной мозаики поверх базовой карты. Слой пересоздаётся на каждый кадр,
// поэтому Leaflet держит уже скачанные тайлы в кэше браузера и перемотка идёт быстро.
export function RadarLayer({ index, frame, opacity }: RadarLayerProps) {
  return (
    <TileLayer
      key={frame.path}
      url={radarTileUrl(index, frame)}
      opacity={opacity}
      zIndex={400}
      tileSize={512}
      zoomOffset={TILE_ZOOM_OFFSET}
      maxNativeZoom={MAX_NATIVE_MAP_ZOOM}
      attribution='Радар — <a href="https://www.rainviewer.com/">RainViewer</a>'
    />
  );
}
