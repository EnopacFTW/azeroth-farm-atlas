// WoW map coordinates are percent: x = 0 (west/left) .. 100 (east/right), y = 0 (north/top) .. 100 (south/bottom).
// Leaflet CRS.Simple uses [lat, lng] with lat growing upwards, so y is negated.
// Map image space: bounds [[-100, 0], [0, 100]] for a 0..100 coordinate plane or [[-H, 0], [0, W]] for an image.

export interface MapSize { width: number; height: number }

export function wowToLatLng(x: number, y: number, size: MapSize = { width: 100, height: 100 }): [number, number] {
  assertPercent(x, y);
  return [-(y / 100) * size.height, (x / 100) * size.width];
}

export function latLngToWow(lat: number, lng: number, size: MapSize = { width: 100, height: 100 }): { x: number; y: number } {
  return { x: (lng / size.width) * 100, y: (-lat / size.height) * 100 };
}

export function wowToPixel(x: number, y: number, size: MapSize): { px: number; py: number } {
  assertPercent(x, y);
  return { px: (x / 100) * size.width, py: (y / 100) * size.height };
}

export function mapBounds(size: MapSize = { width: 100, height: 100 }): [[number, number], [number, number]] {
  return [[-size.height, 0], [0, size.width]];
}

function assertPercent(x: number, y: number) {
  if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new RangeError(`WoW-Koordinaten außerhalb 0..100: ${x}, ${y}`);
}

/** In-game waypoint command, one decimal (TomTom-/Forever-compatible text, no automatic import claimed). */
export function waypoint(x: number, y: number, zoneName?: string): string {
  assertPercent(x, y);
  return `/way ${zoneName ? `${zoneName} ` : ''}${x.toFixed(1)} ${y.toFixed(1)}`;
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
