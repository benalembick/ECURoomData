import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { FloorplanDefinition, FloorplanHotspot } from '../data/floorplans';

const floorplanBucket = 'building-floorplans';

interface DbFloorplan {
  id: string;
  campus_code: string;
  building_code: string;
  building_name: string | null;
  floor_label: string;
  zone: FloorplanDefinition['zone'];
  image_url: string;
  image_storage_path: string | null;
  source_pdf_url: string | null;
  source_pdf_storage_path: string | null;
  original_file_name: string | null;
  source: FloorplanDefinition['source'] | null;
  uploaded_at: string | null;
  building_floorplan_hotspots: DbHotspot[] | null;
}

interface DbHotspot {
  room_code: string;
  room_name: string | null;
  room_type: string | null;
  shape: FloorplanHotspot['shape'];
  points: unknown;
  sort_order: number | null;
}

export async function loadSharedFloorplansFromSupabase(): Promise<FloorplanDefinition[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('building_floorplans')
    .select(`
      id,
      campus_code,
      building_code,
      building_name,
      floor_label,
      zone,
      image_url,
      image_storage_path,
      source_pdf_url,
      source_pdf_storage_path,
      original_file_name,
      source,
      uploaded_at,
      building_floorplan_hotspots(room_code,room_name,room_type,shape,points,sort_order)
    `)
    .order('floor_label')
    .order('zone');

  if (error) {
    if (error.message.includes('building_floorplans')) return [];
    throw new Error(`Could not load shared floorplans: ${error.message}`);
  }

  return ((data ?? []) as unknown as DbFloorplan[]).map(mapDbFloorplan);
}

export async function deleteSharedFloorplanFromSupabase(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('building_floorplans').delete().eq('id', id);
  if (error) throw new Error(`Could not delete floorplan: ${error.message}`);
}

export async function saveSharedFloorplanToSupabase(floorplan: FloorplanDefinition): Promise<FloorplanDefinition> {
  if (!isSupabaseConfigured || !supabase) return floorplan;

  const { data: userResponse, error: userError } = await supabase.auth.getUser();
  if (userError || !userResponse.user) {
    throw new Error('Sign in before uploading a shared floorplan.');
  }

  const storagePrefix = [
    sanitizePathPart(floorplan.campusCode ?? 'campus'),
    sanitizePathPart(floorplan.buildingCode ?? 'building'),
    sanitizePathPart(floorplan.floor),
    sanitizePathPart(floorplan.zone),
  ].join('/');
  const version = Date.now();
  const imageStoragePath = `${storagePrefix}/floorplan-${version}.png`;
  const pdfStoragePath = floorplan.sourcePdfDataUrl ? `${storagePrefix}/source-${version}.pdf` : null;

  const imageBlob = await dataUrlToBlob(floorplan.imagePath);
  await uploadStorageObject(imageStoragePath, imageBlob, 'image/png');
  const imageUrl = getPublicStorageUrl(imageStoragePath);

  let sourcePdfUrl: string | undefined;
  if (floorplan.sourcePdfDataUrl && pdfStoragePath) {
    const pdfBlob = await dataUrlToBlob(floorplan.sourcePdfDataUrl);
    await uploadStorageObject(pdfStoragePath, pdfBlob, 'application/pdf');
    sourcePdfUrl = getPublicStorageUrl(pdfStoragePath);
  }

  const { data: savedFloorplan, error: floorplanError } = await supabase
    .from('building_floorplans')
    .upsert({
      campus_code: floorplan.campusCode ?? '',
      building_code: floorplan.buildingCode ?? '',
      building_name: floorplan.buildingName ?? null,
      floor_label: floorplan.floor,
      zone: floorplan.zone,
      image_url: imageUrl,
      image_storage_path: imageStoragePath,
      source_pdf_url: sourcePdfUrl ?? floorplan.sourcePdfDataUrl ?? null,
      source_pdf_storage_path: pdfStoragePath,
      original_file_name: floorplan.originalFileName ?? null,
      source: floorplan.source ?? 'uploaded-pdf',
      uploaded_by: userResponse.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'campus_code,building_code,floor_label,zone' })
    .select('id')
    .single();

  if (floorplanError) throw new Error(`Could not save shared floorplan: ${floorplanError.message}`);

  const floorplanId = savedFloorplan.id as string;
  const { error: deleteHotspotsError } = await supabase
    .from('building_floorplan_hotspots')
    .delete()
    .eq('floorplan_id', floorplanId);
  if (deleteHotspotsError) throw new Error(`Could not replace floorplan hotspots: ${deleteHotspotsError.message}`);

  if (floorplan.hotspots.length) {
    const { error: hotspotError } = await supabase
      .from('building_floorplan_hotspots')
      .insert(floorplan.hotspots.map((hotspot, index) => ({
        floorplan_id: floorplanId,
        room_code: hotspot.roomCode,
        room_name: hotspot.roomName ?? null,
        room_type: hotspot.roomType ?? null,
        shape: hotspot.shape,
        points: hotspot.points,
        sort_order: index,
      })));
    if (hotspotError) throw new Error(`Could not save floorplan hotspots: ${hotspotError.message}`);
  }

  return {
    ...floorplan,
    id: floorplanId,
    imagePath: imageUrl,
    sourcePdfDataUrl: sourcePdfUrl ?? floorplan.sourcePdfDataUrl,
    uploadedAt: new Date().toISOString(),
  };
}

function mapDbFloorplan(floorplan: DbFloorplan): FloorplanDefinition {
  return {
    id: floorplan.id,
    campusCode: floorplan.campus_code,
    buildingCode: floorplan.building_code,
    buildingName: floorplan.building_name ?? undefined,
    floor: floorplan.floor_label,
    zone: floorplan.zone,
    imagePath: floorplan.image_url,
    imageAlt: `${floorplan.building_name ?? floorplan.building_code} ${floorplan.floor_label} ${floorplan.zone} floorplan`,
    source: floorplan.source ?? 'uploaded-pdf',
    uploadedAt: floorplan.uploaded_at ?? undefined,
    originalFileName: floorplan.original_file_name ?? undefined,
    sourcePdfDataUrl: floorplan.source_pdf_url ?? undefined,
    hotspots: [...(floorplan.building_floorplan_hotspots ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((hotspot) => ({
        roomCode: hotspot.room_code,
        roomName: hotspot.room_name ?? undefined,
        roomType: hotspot.room_type ?? undefined,
        shape: hotspot.shape,
        points: Array.isArray(hotspot.points) ? hotspot.points.map(Number) : [],
      })),
  };
}

async function uploadStorageObject(path: string, blob: Blob, contentType: string) {
  if (!supabase) return;
  const { error } = await supabase.storage
    .from(floorplanBucket)
    .upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`Could not upload floorplan file: ${error.message}`);
}

function getPublicStorageUrl(path: string) {
  if (!supabase) return path;
  return supabase.storage.from(floorplanBucket).getPublicUrl(path).data.publicUrl;
}

async function dataUrlToBlob(value: string) {
  const response = await fetch(value);
  return response.blob();
}

function sanitizePathPart(value: string) {
  return value.trim().replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
}
