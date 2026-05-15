import { supabase } from '../lib/supabase';
import { buildingNameFromCode, floorNameFromCode, parseRoomCode } from '../lib/roomCode';
import type { Building, Campus, Room } from '../types';

export interface CampusMappingPayload {
  campus: Campus;
  rooms: Room[];
  clearBuildingAndFloor?: boolean;
  autoDetectBuildingAndFloor?: boolean;
  onProgress?: (progress: CampusMappingProgress) => void;
}

export interface CampusMappingProgress {
  percent: number;
  completed: number;
  total: number;
  message: string;
}

type RoomUpdate = {
  roomCode: string;
  buildingCode: string;
  floorCode: string;
};

export async function persistCampusDetails(campus: Campus) {
  if (!supabase) return { action: 'demo' as const };
  await requireSignedInUser();

  const { error } = await supabase
    .from('campuses')
    .upsert({
      code: campus.code,
      name: campus.name,
      address: campus.address ?? null,
      is_active: true,
    }, { onConflict: 'code' });

  if (error) throw new Error(`Could not save campus ${campus.code}: ${error.message}`);
  return { action: 'supabase' as const };
}

export async function persistCampusRemoval(campus: Campus) {
  if (!supabase) return { action: 'demo' as const };
  await requireSignedInUser();

  const { error } = await supabase
    .from('campuses')
    .update({ is_active: false })
    .eq('code', campus.code);

  if (error) throw new Error(`Could not remove campus ${campus.code}: ${error.message}`);
  return { action: 'supabase' as const };
}

export async function persistBuildingDetails(building: Building, campuses: Campus[]) {
  if (!supabase) return { action: 'demo' as const };
  await requireSignedInUser();

  const campus = campuses.find((item) => item.code === building.campusCode);
  if (!campus) throw new Error(`Campus ${building.campusCode} must be saved before adding a building.`);

  const { data: campusRow, error: campusError } = await supabase
    .from('campuses')
    .upsert({
      code: campus.code,
      name: campus.name,
      address: campus.address ?? null,
      is_active: true,
    }, { onConflict: 'code' })
    .select('id')
    .single();

  if (campusError) throw new Error(`Could not confirm campus ${campus.code}: ${campusError.message}`);

  const { error } = await supabase
    .from('buildings')
    .upsert({
      campus_id: campusRow.id,
      code: building.code,
      name: building.name,
      owner: building.owner,
      is_active: true,
    }, { onConflict: 'campus_id,code' });

  if (error) throw new Error(`Could not save building ${building.code}: ${error.message}`);
  return { action: 'supabase' as const };
}

export async function persistBuildingRemoval(building: Building, campuses: Campus[]) {
  if (!supabase) return { action: 'demo' as const };
  await requireSignedInUser();

  const campus = campuses.find((item) => item.code === building.campusCode);
  if (!campus) throw new Error(`Campus ${building.campusCode} could not be found for building ${building.code}.`);

  const { data: campusRow, error: campusError } = await supabase
    .from('campuses')
    .select('id')
    .eq('code', campus.code)
    .single();

  if (campusError) throw new Error(`Could not confirm campus ${campus.code}: ${campusError.message}`);

  const { error } = await supabase
    .from('buildings')
    .update({ is_active: false })
    .eq('campus_id', campusRow.id)
    .eq('code', building.code);

  if (error) throw new Error(`Could not remove building ${building.code}: ${error.message}`);
  return { action: 'supabase' as const };
}

export async function persistCampusMapping(payload: CampusMappingPayload) {
  if (!supabase) {
    payload.onProgress?.({ percent: 100, completed: payload.rooms.length, total: payload.rooms.length, message: 'Mapped rooms in demo state' });
    return { action: 'demo' as const, mapped: payload.rooms.length };
  }

  const user = await requireSignedInUser();
  const totalRooms = payload.rooms.length;
  const reportProgress = (percent: number, message: string, completed = Math.round((percent / 100) * totalRooms)) => {
    payload.onProgress?.({
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      completed: Math.min(totalRooms, Math.max(0, completed)),
      total: totalRooms,
      message,
    });
  };

  reportProgress(5, 'Saving campus');

  const { data: campus, error: campusError } = await supabase
    .from('campuses')
    .upsert({
      code: payload.campus.code,
      name: payload.campus.name,
      address: payload.campus.address ?? null,
      is_active: true,
    }, { onConflict: 'code' })
    .select('id,code,name')
    .single();

  if (campusError) throw new Error(`Could not save campus ${payload.campus.code}: ${campusError.message}`);

  const shouldAutoDetect = payload.autoDetectBuildingAndFloor ?? true;
  if (shouldAutoDetect) {
    const parsedUpdates: RoomUpdate[] = [];
    const unparsedRoomCodes: string[] = [];
    payload.rooms.forEach((room) => {
      const parsed = parseRoomCode(room.roomCode);
      if (!parsed) {
        unparsedRoomCodes.push(room.roomCode);
        return;
      }
      parsedUpdates.push({
        roomCode: room.roomCode,
        buildingCode: parsed.buildingCode,
        floorCode: parsed.floorCode,
      });
    });

    const buildingCodes = Array.from(new Set(parsedUpdates.map((room) => room.buildingCode)));
    const buildingIdByCode = new Map<string, string>();
    const floorIdByBuildingAndCode = new Map<string, string>();

    if (buildingCodes.length) {
      reportProgress(15, `Saving ${buildingCodes.length} building reference${buildingCodes.length === 1 ? '' : 's'}`);

      const { data: buildingRows, error: buildingError } = await supabase
        .from('buildings')
        .upsert(
          buildingCodes.map((buildingCode) => ({
            campus_id: campus.id,
            code: buildingCode,
            name: buildingNameFromCode(buildingCode),
            owner: 'Campus Operations',
            is_active: true,
          })),
          { onConflict: 'campus_id,code' },
        )
        .select('id,code');

      if (buildingError) throw new Error(`Could not save building references: ${buildingError.message}`);
      (buildingRows ?? []).forEach((building) => buildingIdByCode.set(building.code, building.id));

      const floorRowsToSave = Array.from(
        new Map(
          parsedUpdates.map((room) => {
            const buildingId = buildingIdByCode.get(room.buildingCode);
            if (!buildingId) throw new Error(`Could not match building ${room.buildingCode} after saving references.`);
            return [`${buildingId}:${room.floorCode}`, {
              building_id: buildingId,
              code: room.floorCode,
              name: floorNameFromCode(room.floorCode),
              sort_order: Number(room.floorCode) || 0,
            }];
          }),
        ).values(),
      );

      reportProgress(30, `Saving ${floorRowsToSave.length} floor reference${floorRowsToSave.length === 1 ? '' : 's'}`);
      const { data: floorRows, error: floorError } = await supabase
        .from('floors')
        .upsert(floorRowsToSave, { onConflict: 'building_id,code' })
        .select('id,building_id,code');

      if (floorError) throw new Error(`Could not save floor references: ${floorError.message}`);
      (floorRows ?? []).forEach((floor) => floorIdByBuildingAndCode.set(`${floor.building_id}:${floor.code}`, floor.id));
    }

    if (unparsedRoomCodes.length) {
      reportProgress(40, `Mapping ${unparsedRoomCodes.length} room${unparsedRoomCodes.length === 1 ? '' : 's'} without building/floor detection`);
      for (const chunk of chunkArray(unparsedRoomCodes, 200)) {
        const { error: roomError } = await supabase
          .from('rooms')
          .update({
            campus_id: campus.id,
            data_quality_flags: ['Campus mapped after import; building/floor could not be detected'],
          })
          .in('room_code', chunk);

        if (roomError) throw new Error(`Could not map imported room campuses: ${roomError.message}`);
      }
    }

    const updatesByLocation = new Map<string, { buildingId: string; floorId: string; roomCodes: string[] }>();
    parsedUpdates.forEach((room) => {
      const buildingId = buildingIdByCode.get(room.buildingCode);
      if (!buildingId) throw new Error(`Could not match building ${room.buildingCode} after saving references.`);
      const floorId = floorIdByBuildingAndCode.get(`${buildingId}:${room.floorCode}`);
      if (!floorId) throw new Error(`Could not match floor ${room.floorCode} for building ${room.buildingCode} after saving references.`);
      const key = `${buildingId}:${floorId}`;
      const group = updatesByLocation.get(key) ?? { buildingId, floorId, roomCodes: [] as string[] };
      group.roomCodes.push(room.roomCode);
      updatesByLocation.set(key, group);
    });

    const updateGroups = Array.from(updatesByLocation.values());
    let updatedRooms = unparsedRoomCodes.length;
    let updatedGroups = 0;
    reportProgress(45, `Mapping ${parsedUpdates.length} room location${parsedUpdates.length === 1 ? '' : 's'}`, updatedRooms);

    for (const group of updateGroups) {
      for (const chunk of chunkArray(group.roomCodes, 200)) {
        const { error: roomError } = await supabase
          .from('rooms')
          .update({
            campus_id: campus.id,
            building_id: group.buildingId,
            floor_id: group.floorId,
            data_quality_flags: ['Campus, building, and floor mapped after import'],
          })
          .in('room_code', chunk);

        if (roomError) throw new Error(`Could not map imported room locations: ${roomError.message}`);
        updatedRooms += chunk.length;
      }
      updatedGroups += 1;
      reportProgress(45 + (updatedGroups / Math.max(1, updateGroups.length)) * 35, 'Mapping room locations', updatedRooms);
    }
  } else {
    let placeholderBuildingId: string | null = null;
    if (payload.clearBuildingAndFloor) {
      const { data: placeholderBuilding, error: placeholderBuildingError } = await supabase
        .from('buildings')
        .upsert({
          campus_id: campus.id,
          code: 'UNMAPPED',
          name: 'Unmapped Building',
          owner: 'Data Governance',
          is_active: true,
        }, { onConflict: 'campus_id,code' })
        .select('id')
        .single();

      if (placeholderBuildingError) {
        throw new Error(`Could not create campus placeholder building: ${placeholderBuildingError.message}`);
      }
      placeholderBuildingId = placeholderBuilding.id;
    }

    const roomCodes = payload.rooms.map((room) => room.roomCode);
    const { error: roomError } = await supabase
      .from('rooms')
      .update({
        campus_id: campus.id,
        ...(payload.clearBuildingAndFloor ? { building_id: placeholderBuildingId, floor_id: null } : {}),
        data_quality_flags: ['Campus mapped after import'],
      })
      .in('room_code', roomCodes);

    if (roomError) throw new Error(`Could not map imported room campuses: ${roomError.message}`);
    reportProgress(80, 'Mapped room campuses', payload.rooms.length);
  }

  const roomCodes = payload.rooms.map((room) => room.roomCode);
  reportProgress(85, 'Writing change log', payload.rooms.length);
  for (const chunk of chunkArray(roomCodes, 500)) {
    const { error: logError } = await supabase
      .from('room_change_log')
      .insert(chunk.map((roomCode) => ({
        actor_id: user.id,
        action: 'Mapped imported room campus',
        after_data: {
          room_code: roomCode,
          campus_code: campus.code,
        },
      })));

    if (logError) throw new Error(`Rooms were mapped, but change log entries could not be written: ${logError.message}`);
  }

  reportProgress(100, 'Mapping complete', payload.rooms.length);
  return { action: 'supabase' as const, mapped: payload.rooms.length };
}

async function requireSignedInUser() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: userResponse, error: userError } = await supabase.auth.getUser();
  if (userError || !userResponse.user) {
    throw new Error('Supabase is configured, but no authenticated user is signed in.');
  }
  return userResponse.user;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
