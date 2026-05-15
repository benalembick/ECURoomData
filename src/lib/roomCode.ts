import type { Building } from '../types';

export interface ParsedRoomCode {
  campusCode: string;
  buildingCode: string;
  floorCode: string;
  roomId: string;
}

export function parseRoomCode(value: string): ParsedRoomCode | null {
  const [campusCode, buildingCode, roomSegment] = value.trim().toUpperCase().split('.');
  if (!campusCode || !buildingCode || !roomSegment || roomSegment.length < 2) return null;

  return {
    campusCode,
    buildingCode,
    floorCode: roomSegment.charAt(0),
    roomId: roomSegment.slice(1),
  };
}

export function buildingNameFromCode(code: string) {
  return code;
}

export function floorNameFromCode(code: string) {
  return code === 'G' ? 'Ground' : `Level ${code}`;
}

export function buildingDisplayName(code: string, campusCode: string, buildings: Building[]) {
  const building = buildings.find((item) => item.campusCode === campusCode && item.code.toUpperCase() === code.toUpperCase());
  if (!building || building.name === code || building.name === `Building ${code}`) return code;
  return `${code} ${building.name}`;
}
