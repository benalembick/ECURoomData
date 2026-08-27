import { supabase } from '../lib/supabase';
import { floorNameFromCode, parseRoomCode } from '../lib/roomCode';
import { findAttributeDefinitionForHeader, roomDataDictionaryByKey } from '../data/roomDataDictionary';
import type { AttributeDefinition, AttributeGroup, Building, Campus, Room, RoomPattern } from '../types';

type JsonValue = string | number | boolean | string[];

interface DbRoom {
  id: string;
  room_code: string;
  name: string;
  capacity: number | null;
  owner: string | null;
  booking_status: string | null;
  is_bookable: boolean;
  is_student_accessible: boolean;
  is_staff_only: boolean;
  is_archived: boolean;
  physical_notes: string | null;
  booking_notes: string | null;
  floorplan_image_url: string | null;
  data_quality_flags: string[] | null;
  campuses: { code: string; name: string } | null;
  buildings: { code: string; name: string } | null;
  floors: { code: string; name: string } | null;
  room_categories: { name: string; is_teaching: boolean; is_specialist: boolean } | null;
  room_patterns: { name: string; downstream_system_codes: string[] | null } | null;
}

interface DbAttributeDefinition {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: string;
  group_name: string;
  is_required: boolean;
  is_visible: boolean;
  downstream_system_codes: string[] | null;
  options: unknown;
  updated_at?: string | null;
}

interface DbAttributeGroup {
  name: string;
  description: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface DbRoomPattern {
  id: string;
  name: string;
  description: string | null;
  default_booking_rules: unknown;
  default_o365_config: unknown;
  timetabling_eligible: boolean;
  ecu_av_patterns: string[] | null;
  vizcom_av_patterns: string[] | null;
  access_logic: unknown;
  required_attribute_keys: string[] | null;
  approval_requirements: unknown;
  downstream_system_codes: string[] | null;
  room_categories: { name: string } | null;
}

interface DbAttributeValue {
  room_id: string;
  attribute_definition_id: string;
  value: JsonValue;
}

interface DbSystemMapping {
  room_id: string;
  systems: { name: string } | null;
}

export interface LoadedRoomData {
  rooms: Room[];
  campuses: Campus[];
  buildings: Building[];
  patterns: RoomPattern[];
  attributes: AttributeDefinition[];
  attributeGroups: AttributeGroup[];
}

export interface RoomDataLoadProgress {
  percent: number;
  completedSteps: number;
  totalSteps: number;
  message: string;
  loadedRows?: number;
}

export async function loadRoomDataFromSupabase(onProgress?: (progress: RoomDataLoadProgress) => void): Promise<LoadedRoomData | null> {
  if (!supabase) return null;
  const client = supabase;
  const totalSteps = 8;
  let completedSteps = 0;

  const reportProgress = (message: string, percent: number, loadedRows?: number) => {
    onProgress?.({
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      completedSteps,
      totalSteps,
      message,
      loadedRows,
    });
  };

  const loadDataset = async <T>(
    createQuery: () => {
      range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    },
    label: string,
  ) => {
    reportProgress(`Loading ${label}`, 5 + (completedSteps / totalSteps) * 80);
    const result = await loadAllRows(createQuery, label, (loadedRows) => {
      reportProgress(`Loading ${label} (${loadedRows.toLocaleString()} rows)`, 5 + (completedSteps / totalSteps) * 80, loadedRows);
    });
    completedSteps += 1;
    reportProgress(`Loaded ${label}`, 5 + (completedSteps / totalSteps) * 80, result.data.length);
    return result;
  };

  const loadDatasetParallel = async <T>(
    createQuery: () => {
      range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
    },
    getCount: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
    label: string,
  ) => {
    reportProgress(`Loading ${label}`, 5 + (completedSteps / totalSteps) * 80);
    const result = await loadAllRowsParallel(createQuery, getCount, label, (loadedRows) => {
      reportProgress(`Loading ${label} (${loadedRows.toLocaleString()} rows)`, 5 + (completedSteps / totalSteps) * 80, loadedRows);
    });
    completedSteps += 1;
    reportProgress(`Loaded ${label}`, 5 + (completedSteps / totalSteps) * 80, result.data.length);
    return result;
  };

  const [campusResult, buildingResult, patternResult, attributeGroupResult, attributeResult, roomResult, valueResult, mappingResult] = await Promise.all([
    loadDataset(() => client.from('campuses').select('code,name,address').eq('is_active', true).order('code'), 'campuses'),
    loadDataset(() => client.from('buildings').select('code,name,owner,campuses(code)').eq('is_active', true).order('code'), 'buildings'),
    loadDataset(
      () =>
        client
          .from('room_patterns')
          .select(`
            id,
            name,
            description,
            default_booking_rules,
            default_o365_config,
            timetabling_eligible,
            ecu_av_patterns,
            vizcom_av_patterns,
            access_logic,
            required_attribute_keys,
            approval_requirements,
            downstream_system_codes,
            room_categories(name)
          `)
          .order('name'),
      'room patterns',
    ),
    loadOptionalDataset(() => client.from('room_attribute_groups').select('*').order('sort_order').order('name'), 'attribute groups'),
    loadDataset(() => client.from('room_attribute_definitions').select('*').order('label'), 'attributes'),
    loadDataset(
      () =>
        client
          .from('rooms')
          .select(`
            id,
            room_code,
            name,
            capacity,
            owner,
            booking_status,
            is_bookable,
            is_student_accessible,
            is_staff_only,
            is_archived,
            physical_notes,
            booking_notes,
            floorplan_image_url,
            data_quality_flags,
            campuses(code,name),
            buildings(code,name),
            floors(code,name),
            room_categories(name,is_teaching,is_specialist),
            room_patterns(name,downstream_system_codes)
          `)
          .order('room_code'),
      'rooms',
    ),
    loadDatasetParallel(
      () => client.from('room_attribute_values').select('room_id,attribute_definition_id,value'),
      () => client.from('room_attribute_values').select('room_id', { count: 'exact', head: true }),
      'room attribute values',
    ),
    loadDataset(() => client.from('system_mappings').select('room_id,systems(name)'), 'system mappings'),
  ]);

  reportProgress('Preparing room search data', 92);

  const campuses: Campus[] = (campusResult.data ?? []).map((campus) => ({
    code: campus.code,
    name: campus.name,
    address: campus.address ?? '',
  }));

  const buildings: Building[] = (buildingResult.data ?? []).map((building) => ({
    code: building.code,
    name: building.name,
    campusCode: relationOne(building.campuses)?.code ?? '',
    owner: building.owner ?? '',
  }));

  const patterns: RoomPattern[] = ((patternResult.data ?? []) as unknown as DbRoomPattern[]).map((pattern) => ({
    id: pattern.id,
    name: pattern.name,
    category: relationOne(pattern.room_categories)?.name ?? 'Unmapped',
    description: pattern.description ?? '',
    ecuAvPatterns: pattern.ecu_av_patterns ?? [],
    vizcomAvPatterns: pattern.vizcom_av_patterns ?? [],
    defaultBookingRules: jsonToList(pattern.default_booking_rules),
    defaultO365Config: jsonToList(pattern.default_o365_config),
    timetablingEligible: pattern.timetabling_eligible,
    accessLogic: jsonToList(pattern.access_logic),
    requiredAttributes: pattern.required_attribute_keys ?? [],
    approvalRequirements: jsonToList(pattern.approval_requirements).map((role) => role.replace(/_/g, ' ')) as RoomPattern['approvalRequirements'],
    downstreamSystems: pattern.downstream_system_codes ?? [],
  }));

  const attributeGroups: AttributeGroup[] = ((attributeGroupResult.data ?? []) as DbAttributeGroup[]).map((group) => ({
    name: group.name,
    description: group.description ?? undefined,
    sortOrder: group.sort_order ?? undefined,
    createdAt: group.created_at ?? undefined,
    updatedAt: group.updated_at ?? undefined,
  }));
  const dbAttributes = (attributeResult.data ?? []) as DbAttributeDefinition[];
  const attributesById = new Map(dbAttributes.map((attribute) => [attribute.id, attribute]));
  const attributes: AttributeDefinition[] = dbAttributes.map((attribute) => {
    const dictionaryDefinition = roomDataDictionaryByKey.get(attribute.key)
      ?? findAttributeDefinitionForHeader(attribute.label)
      ?? findAttributeDefinitionForHeader(attribute.key);
    const groupName = attribute.group_name?.trim();
    const usesGenericGroup = !groupName || groupName === 'Imported' || groupName === 'Custom fields';

    return {
      key: attribute.key,
      label: attribute.label,
      description: attribute.description ?? dictionaryDefinition?.description,
      sourceField: dictionaryDefinition?.sourceField,
      type: toUiAttributeType(attribute.type),
      group: usesGenericGroup ? dictionaryDefinition?.group ?? groupName ?? 'Custom fields' : groupName,
      required: attribute.is_required,
      visible: attribute.is_visible,
      downstreamSystems: attribute.downstream_system_codes?.length ? attribute.downstream_system_codes : dictionaryDefinition?.downstreamSystems ?? [],
      options: Array.isArray(attribute.options) && attribute.options.length ? attribute.options.map(String) : dictionaryDefinition?.options ?? [],
      updatedAt: attribute.updated_at ?? undefined,
    };
  });

  const valuesByRoom = new Map<string, Record<string, JsonValue>>();
  const capabilitiesByRoom = new Map<string, string[]>();
  ((valueResult.data ?? []) as unknown as DbAttributeValue[]).forEach((value) => {
    const definition = attributesById.get(value.attribute_definition_id);
    if (!definition) return;
    const roomValues = valuesByRoom.get(value.room_id) ?? {};
    roomValues[definition.key] = value.value;
    valuesByRoom.set(value.room_id, roomValues);

    const capabilities = capabilitiesByRoom.get(value.room_id) ?? [];
    if (value.value === true) capabilities.push(definition.label);
    if (Array.isArray(value.value)) capabilities.push(...value.value.map(String));
    capabilitiesByRoom.set(value.room_id, capabilities);
  });

  const systemsByRoom = new Map<string, string[]>();
  ((mappingResult.data ?? []) as unknown as DbSystemMapping[]).forEach((mapping) => {
    const system = relationOne(mapping.systems);
    if (!system) return;
    const systems = systemsByRoom.get(mapping.room_id) ?? [];
    systems.push(system.name);
    systemsByRoom.set(mapping.room_id, systems);
  });

  const rooms: Room[] = ((roomResult.data ?? []) as unknown as DbRoom[]).map((room) => {
    const campus = relationOne(room.campuses);
    const building = relationOne(room.buildings);
    const floor = relationOne(room.floors);
    const category = relationOne(room.room_categories);
    const pattern = relationOne(room.room_patterns);
    const parsedRoomCode = parseRoomCode(room.room_code);
    const inferredBuilding = parsedRoomCode && campus?.code === parsedRoomCode.campusCode ? parsedRoomCode.buildingCode : null;
    const inferredFloor = parsedRoomCode && campus?.code === parsedRoomCode.campusCode ? floorNameFromCode(parsedRoomCode.floorCode) : null;
    return {
      id: room.id,
      roomCode: room.room_code,
      name: room.name,
      campus: campus?.name ?? 'Unmapped Campus',
      building: formatBuilding(building, inferredBuilding),
      floor: floor?.name ?? inferredFloor ?? 'Unmapped Floor',
      type: category?.name ?? 'Imported',
      category: category?.name ?? 'Unmapped',
      pattern: pattern?.name ?? 'Unmapped',
      capacity: room.capacity ?? 0,
      owner: room.owner ?? 'Unassigned',
      bookingStatus: room.booking_status ?? 'Imported for review',
      isTeaching: category?.is_teaching ?? false,
      isBookable: room.is_bookable,
      isStudentAccessible: room.is_student_accessible,
      isStaffOnly: room.is_staff_only,
      isSpecialist: category?.is_specialist ?? false,
      isArchived: room.is_archived,
      physicalNotes: room.physical_notes ?? '',
      bookingNotes: room.booking_notes ?? '',
      floorplanImageUrl: room.floorplan_image_url ?? undefined,
      capabilities: capabilitiesByRoom.get(room.id) ?? [],
      attributes: valuesByRoom.get(room.id) ?? {},
      downstreamSystems: systemsByRoom.get(room.id) ?? pattern?.downstream_system_codes ?? [],
      qualityFlags: room.data_quality_flags ?? [],
    };
  });

  reportProgress(`Loaded ${rooms.length.toLocaleString()} rooms`, 100, rooms.length);
  return { rooms, campuses, buildings, patterns, attributes, attributeGroups };
}

async function loadOptionalDataset<T>(
  createQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
  label: string,
) {
  try {
    return await loadAllRows(createQuery, label);
  } catch {
    return { data: [] as T[], error: null };
  }
}

async function loadAllRows<T>(
  createQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
  label: string,
  onPage?: (loadedRows: number) => void,
) {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);
    onPage?.(rows.length);
    if (page.length < pageSize) break;
  }

  return { data: rows, error: null };
}

// Parallel variant: fetches count first, then fires all pages simultaneously.
// Dramatically faster for large tables (e.g. 68k rows = 68 sequential→parallel requests).
async function loadAllRowsParallel<T>(
  createQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
  getCount: () => PromiseLike<{ count: number | null; error: { message: string } | null }>,
  label: string,
  onPage?: (loadedRows: number) => void,
) {
  const pageSize = 1000;

  const { count, error: countError } = await getCount();
  if (countError) throw new Error(`Could not count ${label}: ${countError.message}`);
  if (!count) return { data: [] as T[], error: null };

  let loadedRows = 0;
  const pageCount = Math.ceil(count / pageSize);

  const results = await Promise.all(
    Array.from({ length: pageCount }, (_, i) => {
      const from = i * pageSize;
      return createQuery()
        .range(from, from + pageSize - 1)
        .then((result) => {
          loadedRows += result.data?.length ?? 0;
          onPage?.(loadedRows);
          return result;
        });
    }),
  );

  const rows: T[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
    rows.push(...(result.data ?? []));
  }

  return { data: rows, error: null };
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatBuilding(building: DbRoom['buildings'], inferredBuilding: string | null) {
  if (!building || building.code === 'UNMAPPED') return inferredBuilding ?? 'Unmapped Building';
  if (building.name === building.code || building.name === `Building ${building.code}`) return building.code;
  return `${building.code} ${building.name}`;
}

function toUiAttributeType(type: string): AttributeDefinition['type'] {
  if (type === 'multi_select') return 'multi-select';
  if (type === 'system_reference') return 'system reference';
  if (['text', 'boolean', 'number', 'date', 'select', 'tag', 'url'].includes(type)) {
    return type as AttributeDefinition['type'];
  }
  return 'text';
}

function jsonToList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`);
  }
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}
