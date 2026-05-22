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
export const floorplans: FloorplanDefinition[] = [
  {
    id: 'cc-level-1-north',
    campusCode: 'CC',
    buildingCode: '1',
    buildingName: 'ECU City Campus',
    floor: 'Level 1',
    zone: 'North',
    imagePath: '/floorplans/placeholders/ecu-city-level-1-north.svg',
    imageAlt: 'Placeholder ECU City Campus Level 1 North floorplan',
    hotspots: [
      { roomCode: 'CC.1N.101', shape: 'rect', points: [8, 18, 12, 18] },
      { roomCode: 'CC.1N.108', shape: 'rect', points: [22, 18, 15, 18] },
      { roomCode: 'CC.1N.114', shape: 'rect', points: [43, 18, 18, 22] },
      { roomCode: 'CC.1N.130', shape: 'polygon', points: [67, 18, 88, 18, 88, 43, 79, 48, 67, 42] },
      { roomCode: 'CC.1N.134', shape: 'rect', points: [11, 60, 17, 20] },
      { roomCode: 'CC.1N.151', shape: 'rect', points: [36, 60, 12, 18] },
      { roomCode: 'CC.1N.164', shape: 'rect', points: [59, 60, 13, 18] },
    ],
  },
  {
    id: 'cc-level-1-south',
    campusCode: 'CC',
    buildingCode: '1',
    buildingName: 'ECU City Campus',
    floor: 'Level 1',
    zone: 'South',
    imagePath: '/floorplans/placeholders/ecu-city-level-1-south.svg',
    imageAlt: 'Placeholder ECU City Campus Level 1 South floorplan',
    hotspots: [
      { roomCode: 'CC.1S.7C01', shape: 'rect', points: [10, 19, 17, 19] },
      { roomCode: 'CC.1S.7C02', shape: 'rect', points: [31, 19, 15, 19] },
      { roomCode: 'CC.1S.GST02', shape: 'rect', points: [54, 18, 24, 23] },
      { roomCode: 'CC.1S.1ST02', shape: 'rect', points: [17, 60, 13, 18] },
      { roomCode: 'CC.1S.1C10', shape: 'polygon', points: [45, 57, 68, 57, 73, 74, 53, 82, 42, 73] },
    ],
  },
  {
    id: 'cc-level-2-both',
    campusCode: 'CC',
    buildingCode: '1',
    buildingName: 'ECU City Campus',
    floor: 'Level 2',
    zone: 'Both',
    imagePath: '/floorplans/placeholders/ecu-city-level-2-both.svg',
    imageAlt: 'Placeholder ECU City Campus Level 2 combined North and South floorplan',
    hotspots: [
      { roomCode: 'CC.1N.201', shape: 'rect', points: [8, 18, 13, 17] },
      { roomCode: 'CC.1N.204', shape: 'rect', points: [26, 18, 14, 17] },
      { roomCode: 'CC.1S.201', shape: 'rect', points: [61, 18, 13, 17] },
      { roomCode: 'CC.1S.208', shape: 'rect', points: [78, 18, 13, 17] },
      { roomCode: 'CC.1N.230', shape: 'rect', points: [18, 60, 20, 19] },
      { roomCode: 'CC.1S.230', shape: 'rect', points: [62, 60, 20, 19] },
    ],
  },
];
