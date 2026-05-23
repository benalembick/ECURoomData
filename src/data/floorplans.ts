export type FloorplanZone = 'North' | 'South' | 'Both';

export interface FloorplanHotspot {
  roomCode: string;
  roomName?: string;
  roomType?: string;
  shape: 'rect' | 'polygon';
  /**
   * Percent-based SVG coordinates in the floorplan coordinate space.
   * Rectangles use [x, y, width, height]; polygons use [x1, y1, x2, y2, ...].
   */
  points: number[];
}

export interface FloorplanDefinition {
  id: string;
  campusCode?: string;
  buildingCode?: string;
  buildingName?: string;
  floor: string;
  zone: FloorplanZone;
  imagePath: string;
  imageAlt: string;
  source?: 'static' | 'uploaded-pdf';
  uploadedAt?: string;
  originalFileName?: string;
  sourcePdfDataUrl?: string;
  hotspots: FloorplanHotspot[];
}

/*
 * Floorplan data is intentionally config-driven so a future admin editor can
 * persist the same shape. Add real ECU City Campus floorplan images under
 * public/floorplans/, then add or update entries here with percent-based
 * hotspot coordinates.
 */
export const floorplans: FloorplanDefinition[] = [];
