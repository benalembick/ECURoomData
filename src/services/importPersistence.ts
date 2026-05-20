import { supabase } from '../lib/supabase';
import type { AttributeDefinition, ImportPreviewRow } from '../types';
import { makeAttributeKey, roomDataDictionaryByKey } from '../data/roomDataDictionary';

type ImportAction = 'supabase' | 'demo';

export interface PersistImportPayload {
  filename: string;
  rows: ImportPreviewRow[];
  mapping: Record<string, string>;
  createdFields: AttributeDefinition[];
  onProgress?: (progress: PersistImportProgress) => void;
}

export interface PersistImportResult {
  action: ImportAction;
  importJobId?: string;
  created: number;
  updated: number;
  attributeValues: number;
  newFields: string[];
}

export interface PersistImportProgress {
  percent: number;
  message: string;
  processedRows: number;
  totalRows: number;
  created: number;
  updated: number;
  attributeValues: number;
}

interface ReferenceRecord {
  id: string;
  code?: string;
  name: string;
  campus_id?: string;
  building_id?: string;
  category_id?: string;
}

export async function persistImportToSupabase(payload: PersistImportPayload): Promise<PersistImportResult> {
  const validRows = payload.rows.filter((row) => row.action !== 'error');

  if (!supabase) {
    const demoAttributeValues = countMappedAttributeValues(validRows, payload.mapping);
    payload.onProgress?.({
      percent: 100,
      message: 'Import complete in demo mode.',
      processedRows: validRows.length,
      totalRows: validRows.length,
      created: payload.rows.filter((row) => row.action === 'create').length,
      updated: payload.rows.filter((row) => row.action === 'update').length,
      attributeValues: demoAttributeValues,
    });

    return {
      action: 'demo',
      created: payload.rows.filter((row) => row.action === 'create').length,
      updated: payload.rows.filter((row) => row.action === 'update').length,
      attributeValues: demoAttributeValues,
      newFields: getDynamicAttributeDefinitionsFromMapping(
        payload.mapping,
        validRows.map((row) => row.source),
        [],
      ).map((field) => field.label),
    };
  }

  const { data: userResponse, error: userError } = await supabase.auth.getUser();
  if (userError || !userResponse.user) {
    throw new Error('Supabase is configured, but no authenticated user is signed in. Sign in with a profile role of room_data_editor or admin before committing imports.');
  }

  const importAttributeDefinitions = mergeAttributeDefinitions(
    payload.createdFields,
    getDynamicAttributeDefinitionsFromMapping(
      payload.mapping,
      validRows.map((row) => row.source),
      payload.createdFields,
    ),
  );
  const dynamicAttributeKeys = new Set(
    getDynamicAttributeDefinitionsFromMapping(
      payload.mapping,
      validRows.map((row) => row.source),
      [],
    ).map((field) => field.key),
  );

  const reportProgress = (
    percent: number,
    message: string,
    processedRows: number,
    created: number,
    updated: number,
    attributeValues: number,
  ) => {
    payload.onProgress?.({
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      message,
      processedRows,
      totalRows: validRows.length,
      created,
      updated,
      attributeValues,
    });
  };

  reportProgress(5, 'Preparing import references.', 0, 0, 0, 0);

  const [campuses, buildings, floors, categories, patterns, attributes] = await Promise.all([
    fetchReference('campuses'),
    fetchReference('buildings'),
    fetchReference('floors'),
    fetchReference('room_categories'),
    fetchReference('room_patterns'),
    fetchReference('room_attribute_definitions'),
  ]);

  const { data: importJob, error: importError } = await supabase
    .from('import_jobs')
    .insert({
      filename: payload.filename,
      status: 'validated',
      uploaded_by: userResponse.user.id,
      headers: Object.keys(payload.mapping),
      sample_rows: validRows.slice(0, 10).map((row) => row.source),
      field_mapping: payload.mapping,
      validation_summary: {
        create: payload.rows.filter((row) => row.action === 'create').length,
        update: payload.rows.filter((row) => row.action === 'update').length,
        error: payload.rows.filter((row) => row.action === 'error').length,
        dynamic_fields: importAttributeDefinitions.map((field) => field.key),
      },
      created_attribute_keys: importAttributeDefinitions.map((field) => field.key),
    })
    .select('id')
    .single();

  if (importError) throw new Error(`Could not create import audit job: ${importError.message}`);
  reportProgress(12, 'Import audit job created.', 0, 0, 0, 0);

  const attributeIdByKey = new Map<string, string>();
  attributes.forEach((attribute) => {
    if (attribute.code) attributeIdByKey.set(attribute.code, attribute.id);
  });

  const newFields: string[] = [];
  for (const field of importAttributeDefinitions) {
    const existingId = attributeIdByKey.get(field.key);
    if (existingId) continue;
    const { data, error } = await supabase
      .from('room_attribute_definitions')
      .insert({
        key: field.key,
        label: field.label,
        description: field.description ?? null,
        type: toDatabaseAttributeType(field.type),
        group_name: field.group,
        is_required: field.required,
        is_visible: field.visible,
        downstream_system_codes: field.downstreamSystems,
        options: field.options ?? [],
      })
      .select('id,key')
      .single();

    if (error) throw new Error(`Could not create dynamic attribute "${field.label}": ${error.message}`);
    attributeIdByKey.set(data.key, data.id);
    if (dynamicAttributeKeys.has(field.key)) newFields.push(field.label);
  }
  reportProgress(18, 'Dynamic attributes are ready.', 0, 0, 0, 0);

  for (const attribute of attributes) {
    const key = attribute.code;
    if (key) attributeIdByKey.set(key, attribute.id);
  }

  const defaultCampus = campuses[0];
  const defaultBuilding = buildings[0];
  const defaultCategory = findByName(categories, 'Support Space') ?? categories[0];
  const defaultPattern = findByName(patterns, 'Meeting Room') ?? patterns[0];

  let created = 0;
  let updated = 0;
  let attributeValues = 0;

  for (const [index, previewRow] of validRows.entries()) {
    const mapped = mapImportSource(previewRow.source, payload.mapping, importAttributeDefinitions);
    const campus = resolveReference(campuses, mapped.campus) ?? defaultCampus;
    const building = resolveBuilding(buildings, mapped.building, campus?.id) ?? defaultBuilding;
    const floor = resolveFloor(floors, mapped.floor, building?.id);
    const pattern = resolveReference(patterns, mapped.pattern) ?? defaultPattern;
    const category = pattern?.category_id
      ? categories.find((item) => item.id === pattern.category_id)
      : defaultCategory;

    if (!campus || !building || !category || !pattern) {
      throw new Error('Supabase seed/reference data is missing a default campus, building, category, or pattern. Run the supplied seed.sql before importing.');
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .upsert({
        room_code: mapped.roomCode,
        name: mapped.name ?? mapped.roomCode,
        campus_id: campus.id,
        building_id: building.id,
        floor_id: floor?.id ?? null,
        category_id: category.id,
        pattern_id: pattern.id,
        capacity: Number(mapped.capacity) || 0,
        owner: mapped.owner ?? 'Imported',
        booking_status: mapped.bookingStatus ?? 'Imported for review',
        physical_notes: 'Imported from CSV and awaiting review.',
        booking_notes: 'Booking configuration requires governance review.',
        data_quality_flags: [previewRow.action === 'update' ? 'Imported update pending governance review' : 'Imported record pending validation'],
      }, { onConflict: 'room_code' })
      .select('id,room_code')
      .single();

    if (roomError) throw new Error(`Could not upsert room ${mapped.roomCode}: ${roomError.message}`);

    if (previewRow.action === 'create') created += 1;
    if (previewRow.action === 'update') updated += 1;

    const attributeValueRows = Object.entries(mapped.attributes).flatMap(([key, value]) => {
      const attribute_definition_id = attributeIdByKey.get(key);
      if (!attribute_definition_id) return [];
      return [{
        room_id: room.id,
        attribute_definition_id,
        value,
        updated_by: userResponse.user.id,
      }];
    });

    if (attributeValueRows.length) {
      const { error } = await supabase
        .from('room_attribute_values')
        .upsert(attributeValueRows, { onConflict: 'room_id,attribute_definition_id' });
      if (error) throw new Error(`Could not save attribute values for ${mapped.roomCode}: ${error.message}`);
    }
    attributeValues += attributeValueRows.length;

    const { error: logError } = await supabase
      .from('room_change_log')
      .insert({
        room_id: room.id,
        actor_id: userResponse.user.id,
        action: `CSV import ${previewRow.action}`,
        after_data: {
          import_job_id: importJob.id,
          mapped,
        },
      });

    if (logError) throw new Error(`Could not write change log for ${mapped.roomCode}: ${logError.message}`);
    reportProgress(
      18 + ((index + 1) / Math.max(validRows.length, 1)) * 76,
      `Imported ${index + 1} of ${validRows.length} row${validRows.length === 1 ? '' : 's'}.`,
      index + 1,
      created,
      updated,
      attributeValues,
    );
  }

  reportProgress(96, 'Finalising import audit status.', validRows.length, created, updated, attributeValues);

  const { error: completeError } = await supabase
    .from('import_jobs')
    .update({ status: 'committed', committed_at: new Date().toISOString() })
    .eq('id', importJob.id);

  if (completeError) throw new Error(`Import completed, but the import job could not be marked committed: ${completeError.message}`);
  reportProgress(100, 'Import complete.', validRows.length, created, updated, attributeValues);

  return {
    action: 'supabase',
    importJobId: importJob.id,
    created,
    updated,
    attributeValues,
    newFields,
  };
}

async function fetchReference(table: string): Promise<ReferenceRecord[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? []).map((item) => ({
    id: String(item.id),
    code: String(item.code ?? item.key ?? ''),
    name: String(item.name ?? item.label ?? ''),
    campus_id: item.campus_id ? String(item.campus_id) : undefined,
    building_id: item.building_id ? String(item.building_id) : undefined,
    category_id: item.category_id ? String(item.category_id) : undefined,
  }));
}

function findByName(records: ReferenceRecord[], name: string) {
  return records.find((record) => record.name.toLowerCase() === name.toLowerCase());
}

function resolveReference(records: ReferenceRecord[], value?: string | number) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  return records.find((record) => {
    const code = record.code?.toLowerCase();
    const name = record.name.toLowerCase();
    return code === normalized || name === normalized || normalized.includes(name) || (code ? normalized.startsWith(code) : false);
  });
}

function resolveBuilding(records: ReferenceRecord[], value?: string | number, campusId?: string) {
  const matches = records.filter((record) => !campusId || record.campus_id === campusId);
  return resolveReference(matches, value) ?? resolveReference(records, value);
}

function resolveFloor(records: ReferenceRecord[], value?: string | number, buildingId?: string) {
  const matches = records.filter((record) => !buildingId || record.building_id === buildingId);
  return resolveReference(matches, value);
}

function toDatabaseAttributeType(type: AttributeDefinition['type']) {
  return type.replace('-', '_').replace(' ', '_');
}

function mergeAttributeDefinitions(...groups: AttributeDefinition[][]) {
  const byKey = new Map<string, AttributeDefinition>();
  groups.flat().forEach((attribute) => byKey.set(attribute.key, attribute));
  return Array.from(byKey.values());
}

function countMappedAttributeValues(rows: ImportPreviewRow[], mapping: Record<string, string>) {
  return rows.reduce((total, row) => {
    return total + Object.entries(mapping).filter(([header, destination]) => {
      return Boolean(row.source[header])
        && (destination === 'create_dynamic_attribute' || destination.startsWith('attr:'));
    }).length;
  }, 0);
}

function getDynamicAttributeDefinitionsFromMapping(
  mapping: Record<string, string>,
  rows: Record<string, string>[],
  existingFields: AttributeDefinition[] = [],
) {
  return Object.entries(mapping).flatMap(([header, destination]) => {
    if (destination !== 'create_dynamic_attribute') return [];
    const key = makeAttributeKey(header);
    if (!key || existingFields.some((field) => field.key === key)) return [];

    return [{
      key,
      label: titleCase(header),
      type: inferType(rows.map((row) => row[header])),
      group: 'Custom fields',
      required: false,
      visible: true,
      downstreamSystems: [],
    }];
  });
}

function mapImportSource(source: Record<string, string>, mapping: Record<string, string>, dynamicFields: AttributeDefinition[]) {
  const mapped: {
    roomCode: string;
    name?: string;
    campus?: string;
    building?: string;
    floor?: string;
    capacity?: number;
    owner?: string;
    pattern?: string;
    bookingStatus?: string;
    attributes: Record<string, string | boolean | number | string[]>;
  } = {
    roomCode: '',
    attributes: {},
  };

  Object.entries(mapping).forEach(([header, destination]) => {
    const value = source[header];
    if (!value || destination === 'ignore') return;
    if (destination === 'create_dynamic_attribute') {
      const key = makeAttributeKey(header);
      const field = dynamicFields.find((item) => item.key === key);
      mapped.attributes[key] = coerceImportValue(value, field?.type ?? 'text');
      return;
    }

    if (destination.startsWith('attr:')) {
      const key = destination.slice(5);
      const field = dynamicFields.find((item) => item.key === key) ?? roomDataDictionaryByKey.get(key);
      mapped.attributes[key] = coerceImportValue(value, field?.type ?? 'text');
      return;
    }

    switch (destination) {
      case 'roomCode':
        mapped.roomCode = value;
        break;
      case 'name':
        mapped.name = value;
        break;
      case 'campus':
        mapped.campus = value;
        break;
      case 'building':
        mapped.building = value;
        break;
      case 'floor':
        mapped.floor = value;
        break;
      case 'capacity':
        mapped.capacity = Number(value);
        break;
      case 'owner':
        mapped.owner = value;
        break;
      case 'pattern':
        mapped.pattern = value;
        break;
      case 'bookingStatus':
        mapped.bookingStatus = value;
        break;
      default:
        break;
    }
  });

  return mapped;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferType(values: string[]): AttributeDefinition['type'] {
  const sample = values.filter(Boolean).slice(0, 10);
  if (sample.length && sample.every((value) => ['yes', 'no', 'true', 'false', 'y', 'n'].includes(value.toLowerCase()))) return 'boolean';
  if (sample.length && sample.every((value) => !Number.isNaN(Number(value)))) return 'number';
  if (sample.length && sample.every((value) => !Number.isNaN(Date.parse(value)))) return 'date';
  if (sample.some((value) => value.includes(','))) return 'multi-select';
  return 'text';
}

function coerceImportValue(value: string, type: AttributeDefinition['type']) {
  if (type === 'boolean') return ['yes', 'true', 'y', '1', 'bookable', 'available'].includes(value.toLowerCase());
  if (type === 'number') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : value;
  }
  if (type === 'multi-select') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return value;
}
