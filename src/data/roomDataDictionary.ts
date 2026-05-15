import type { AttributeDefinition, AttributeType } from '../types';

type DictionaryRow = [group: string, field: string, type?: string, description?: string];

export const roomDataDictionaryGroupOrder = [
  'ROOM Details',
  'ROOM IDENTIFICATION',
  'Timetabling Info',
  'ROOM CONTENTS & CAPABILITIES',
  'AMENITIES',
  'BOOKING DATA',
  'APPSPACE DATA',
  'HECTOR',
  'MOMENTUS',
];

const groupOrder = new Map(roomDataDictionaryGroupOrder.map((group, index) => [group.toLowerCase(), index]));

export function compareRoomDataDictionaryGroups(a: string, b: string) {
  const aIndex = groupOrder.get(a.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  const bIndex = groupOrder.get(b.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;

  return aIndex - bIndex || a.localeCompare(b);
}

export const roomDataDictionaryRows: DictionaryRow[] = [
  ['ROOM IDENTIFICATION', 'id', 'Text/Alphanumeric', 'ID stored in the excel spreadsheet only'],
  ['ROOM IDENTIFICATION', 'CONCAT ID', 'Text/Alphanumeric', 'Composite room identifier'],
  ['ROOM IDENTIFICATION', 'ARCHIBUS ID', 'Text/Alphanumeric', 'ID used within Archibus'],
  ['ROOM IDENTIFICATION', 'ECUSIS FLOOR ID', 'Text/Alphanumeric', 'Unique ID for floor in ECUSIS system'],
  ['ROOM IDENTIFICATION', 'FLOOR', 'Text/Alphanumeric', 'Floor number or letter'],
  ['ROOM IDENTIFICATION', 'CAMPUS ID', 'Text', 'Campus identifier'],
  ['ROOM IDENTIFICATION', 'BUILDING ID', 'Text/Alphanumeric', 'Building identifier'],
  ['ROOM IDENTIFICATION', 'ROOM ID', 'Text/Alphanumeric', 'Room identifier'],
  ['ROOM IDENTIFICATION', 'ROOM NUMBER', 'Text/Alphanumeric', 'Room number within the building'],
  ['ROOM IDENTIFICATION', 'FLOORPLAN ROOM ID'],
  ['ROOM IDENTIFICATION', 'FULL ROOM NUMBER'],
  ['ROOM IDENTIFICATION', 'Outlook Floors (number only)'],
  ['ROOM Details', 'MAY2025 ROOM ID CHANGES (CONFIRMED)', undefined, 'Floorplan room numbers prior to the July room number update'],
  ['ROOM Details', 'HISTORIC FLOORPLAN ROOM NAME', 'Text', 'Original name of the room per architectural plans'],
  ['ROOM Details', 'FINAL ROOM NAME', 'Text', 'Finalised name to be used for signage'],
  ['ROOM Details', 'Assigned Department', 'Text', 'Department responsible for the space'],
  ['ROOM Details', 'Assigned Sub Department', 'Text', 'Further division of the assigned department'],
  ['ROOM Details', 'Capacity (Afm.rm.capacity)', 'Integer', 'Number of people the room can accommodate'],
  ['ROOM Details', 'Average m2', 'Integer', 'Average area based on SoFA data'],
  ['Timetabling Info', 'Teaching Capacity'],
  ['Timetabling Info', 'IS TEACHING SPACE', 'Y/N', 'Generic yes or no if teaching occurs in the space'],
  ['Timetabling Info', 'NON TIMETABLED', 'Boolean', 'Indicates if the room is not timetabled'],
  ['Timetabling Info', 'TYPE (Standard or specialised)', '"Standard" / "Specialised"', 'Room type classification'],
  ['Timetabling Info', 'TIMETABLE ROOM POOL CODE (for Outlook Name)'],
  ['Timetabling Info', '1st Preference', 'Text', 'Primary School or use of the room'],
  ['Timetabling Info', '1st Preference (WAAPA Sub Area)', 'Text', 'Preferred WAAPA sub-area use'],
  ['Timetabling Info', 'Timetabling ROOM POOL', 'Text', 'Room Pools used by timetabling'],
  ['ROOM CONTENTS & CAPABILITIES', 'COMPUTER LAB', 'Y/N', 'Indicates if the room is a computer lab and compute type used'],
  ['ROOM CONTENTS & CAPABILITIES', 'FUSR - FF&E - Audio Visual', 'Text/List', 'AV setup/fittings details'],
  ['ROOM CONTENTS & CAPABILITIES', 'ROOM CAPABILITY AV', 'Text', 'AV configuration'],
  ['ROOM CONTENTS & CAPABILITIES', 'ROOM CAPABILITY PIANO', 'Y/N', 'Indicates if the room contains a piano and details about pianos'],
  ['ROOM CONTENTS & CAPABILITIES', 'PIANO MODEL (FINAL)', undefined, 'Final piano model from July 2025'],
  ['ROOM CONTENTS & CAPABILITIES', 'CATEGORY (from waapa)', undefined, 'Room categories as identified by WAAPA'],
  ['ROOM CONTENTS & CAPABILITIES', 'SUB FLOOR / FLOOR SURFACE TREATMENT', 'Text', 'Floor type'],
  ['ROOM CONTENTS & CAPABILITIES', 'Printer', 'Text', 'Availability of printer'],
  ['ROOM CONTENTS & CAPABILITIES', 'PEOPLE COUNTING', 'Boolean', 'Does the space have people counting capability'],
  ['AV DATA', 'FACILITATOR BENCH MODEL', 'Text', 'Model of facilitator bench'],
  ['AV DATA', 'FACILITATOR TABLET', 'Text', 'Model of tablet if required for the facilitator'],
  ['AV DATA', 'ECU AV PATTERN'],
  ['AV DATA', 'VIZCOM PATTERN', 'Text', 'Room AV pattern identified by Vizcoms BOM v3.0'],
  ['AV DATA', 'MTR ADDRESS', 'Email Address', 'Microsoft Teams Room address'],
  ['AV DATA', 'ROOM ADDRESS', 'Email Address', 'Address for room once added to Exchange for booking purposes'],
  ['AV DATA', 'FACILITATOR BENCH PIN CODE', 'Integer', 'Pin code for facilitator bench drawer'],
  ['AV DATA', 'AV DLP Support Level (Defects Liability Period)', 'Text', 'Level of DLP support agreed'],
  ['AV DATA', 'PREDOMINANT COMPUTE', 'e.g., Windows / Mac / None', 'Main type of computer hardware'],
  ['AV DATA', 'Digital Screen Use (multiple might exist)', 'Text', 'Digital screen information'],
  ['AV DATA', 'Has Room Booking Panel', undefined, 'Does the space require a room booking panel outside'],
  ['AV DATA', 'Room Booking Panel Allows Annonymous Walk Up', undefined, 'Does the panel allow anonymous walk up instant bookings'],
  ['AV DATA', 'AV PVT', undefined, 'Product validation testing phase associated with the room'],
  ['BOOKING DATA', 'CREATE RESOURCE ACC IN AZURE (Y/N)', 'Y/N', 'Whether to create an Azure resource account'],
  ['BOOKING DATA', 'CREATE IN OUTLOOK', 'Y/N', 'Whether to create the room in Outlook'],
  ['BOOKING DATA', 'OUTLOOK DISPLAY NAME', undefined, 'Name displayed in Outlook'],
  ['BOOKING DATA', 'OUTLOOK DISPLAY NAME - LEN()', undefined, 'Length of display name'],
  ['BOOKING DATA', 'OUTLOOK ROOM TAGS', undefined, 'Room tags uploaded to Outlook'],
  ['BOOKING DATA', 'BOOKABLE AUDIENCE GROUPS (bookingResourceUserPermission)', 'Text/List', 'Groups allowed to book the resource'],
  ['BOOKING DATA', 'BOOKING APPROVER GROUPS (BookingResourceAPPROVERS)', 'Text', 'AD group assigned as booking approvers'],
  ['BOOKING DATA', 'ROOM LICENSE & SUPPORT GROUPS (bookingResourceAdministrativeMgtPermissions)'],
  ['BOOKING DATA', 'ALLOW CONFLICTS', 'Boolean', 'Allow multiple bookings at the same time'],
  ['BOOKING DATA', 'OUTLOOK / BOOKING AVAILABLE', 'Boolean', 'Outlook system allowed to make bookings'],
  ['BOOKING DATA', 'APPSPACE / BOOKING AVAILABLE', 'Boolean', 'Appspace system allowed to make bookings'],
  ['BOOKING DATA', 'MOMENTUS / BOOKING AVAILABLE', 'Boolean', 'Momentus system allowed to make bookings'],
  ['BOOKING DATA', 'PHYSICAL LOCK STATUS', 'Text', 'Gallagher lock status of a room'],
  ['BOOKING DATA', 'APPROVAL WORKFLOW NOTES'],
  ['BOOKING DATA', 'WAAPA Staff Bookable'],
  ['BOOKING DATA', 'WAAPA Students Bookable'],
  ['BOOKING DATA', 'WAAPA OUTLOOK / BOOKING AVAILABLE'],
  ['BOOKING DATA', 'WAAPA APPSPACE / BOOKING AVAILABLE'],
  ['BOOKING DATA', 'WAAPA MOMENTUS / BOOKING AVAILABLE'],
  ['AMENITIES', 'HAS AMENITIES', 'Boolean', 'Does the room have amenities'],
  ['AMENITIES', 'Room Amenity ROOM TYPE', 'Text/List', 'Amenity room type'],
  ['AMENITIES', 'Room Amenity AUDIO', 'Boolean', 'Audio amenity available'],
  ['AMENITIES', 'Room Amenity ROOM MICROPHONE', 'Boolean', 'Room microphone amenity available'],
  ['AMENITIES', 'Room Amenity DISPLAY', 'Boolean', 'Display amenity available'],
  ['AMENITIES', 'Room Amenity ROOM CAMERA', 'Boolean', 'Room camera amenity available'],
  ['AMENITIES', 'Room Amenity MTR (TEAMS)', 'Boolean', 'Microsoft Teams Room amenity available'],
  ['AMENITIES', 'Room Amenity DOCUMENT CAMERA', 'Boolean', 'Document camera amenity available'],
  ['AMENITIES', 'Room Amenity PC', 'Boolean', 'PC amenity available'],
  ['AMENITIES', 'Room Amenity FLOOR TYPE', 'Text/List', 'Flat floor, tiered floor, or sprung floor'],
  ['AMENITIES', 'Room Amenity KITCHENETTE', 'Boolean', 'Kitchenette amenity available'],
  ['AMENITIES', 'Room Amenity MIRROR', 'Boolean', 'Mirror amenity available'],
  ['AMENITIES', 'Room Amenity FACILITATOR BENCH', 'Text/List', 'Facilitator bench amenity details'],
  ['AMENITIES', 'Room Amenity STUDENT PODS', 'Boolean', 'Student pods amenity available'],
  ['AMENITIES', 'Room Amenity MOVABLE FURNITURE', 'Boolean', 'Movable furniture amenity available'],
  ['AMENITIES', 'Room Amenity INSTRUMENT', 'Text/List', 'Instrument amenity details'],
  ['APPSPACE DATA', 'IN APPSPACE (needs to be confirmed)'],
  ['APPSPACE DATA', 'Appspace Space Type', 'Text', 'Space type as defined in Appspace'],
  ['APPSPACE DATA', 'Appspace Space Sub-Type', 'Text', 'Sub-type definition for Appspace integration'],
  ['APPSPACE DATA', 'Appspace Amenities', 'Text/List', 'Amenities available in Appspace'],
  ['APPSPACE DATA', 'AppSpace Device Name'],
  ['MOMENTUS', 'OUTLOOK, APPSPACE, HECTOR & MOMENTUS Long Description'],
  ['MOMENTUS', 'MOMENTUS - Abbreviated Description'],
  ['MOMENTUS', 'MOMENTUS - UNIQUE CODE'],
  ['MOMENTUS', 'MOMENTUS - SPACE TYPE'],
  ['MOMENTUS', 'IN MOMENTUS?'],
  ['HECTOR', 'IN HECTOR?'],
  ['HECTOR', 'Bookable via Hector?'],
  ['HECTOR', 'Hector Abbreviated Description'],
  ['HECTOR', 'Hector SPACE TYPE'],
  ['HECTOR', 'PROFICIENCY REQUIRED FOR ROOM BOOKING'],
  ['HECTOR', 'PROFICIENCY GROUP'],
  ['HECTOR', 'SAH Team Comments'],
];

export const coreRoomFieldOptions = [
  { value: 'ignore', label: 'Ignore' },
  { value: 'roomCode', label: 'Room code' },
  { value: 'name', label: 'Room name' },
  { value: 'campus', label: 'Campus' },
  { value: 'building', label: 'Building' },
  { value: 'floor', label: 'Floor' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'owner', label: 'Owner / department' },
  { value: 'pattern', label: 'Room pattern/type' },
  { value: 'bookingStatus', label: 'Booking status' },
  { value: 'create_dynamic_attribute', label: 'Create new dynamic attribute' },
];

const usedKeys = new Map<string, number>();

export const roomDataDictionaryDefinitions: AttributeDefinition[] = roomDataDictionaryRows.map(([group, field, dataType, description]) => {
  const baseKey = makeAttributeKey(field);
  const count = usedKeys.get(baseKey) ?? 0;
  usedKeys.set(baseKey, count + 1);
  const key = count ? `${baseKey}_${count + 1}` : baseKey;

  return {
    key,
    label: field,
    description,
    sourceField: field,
    type: toAttributeType(dataType),
    group,
    required: isRequiredDictionaryField(field),
    visible: true,
    downstreamSystems: downstreamSystemsForGroup(group, field),
    options: optionsForField(field),
  };
});

export const roomDataDictionaryByKey = new Map(roomDataDictionaryDefinitions.map((field) => [field.key, field]));

export function normalizeDictionaryHeader(value: string) {
  return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

export function findDictionaryDefinitionForHeader(header: string) {
  return findAttributeDefinitionForHeader(header, roomDataDictionaryDefinitions);
}

export function findAttributeDefinitionForHeader(header: string, definitions: AttributeDefinition[] = roomDataDictionaryDefinitions) {
  const normalizedValues = normalizedHeaderCandidates(header);
  const normalizedKey = makeAttributeKey(header);
  const parentheticalValues = Array.from(header.matchAll(/\(([^)]+)\)/g), (match) => match[1]);
  const normalizedParenthetical = parentheticalValues.map(normalizeDictionaryHeader);
  const keyParenthetical = parentheticalValues.map(makeAttributeKey);

  const exact = definitions.find((definition) => {
    const label = normalizeDictionaryHeader(definition.sourceField ?? definition.label);
    const key = makeAttributeKey(definition.key);
    return normalizedValues.includes(label)
      || key === normalizedKey
      || normalizedParenthetical.includes(label)
      || keyParenthetical.includes(key);
  });
  if (exact) return exact;

  const rankedMatches = definitions
    .map((definition) => {
      const label = normalizeDictionaryHeader(definition.sourceField ?? definition.label);
      const keyText = normalizeDictionaryHeader(definition.key);
      const labelMatches = label.length > 2 && normalizedValues.some((value) => value.includes(label) || label.includes(value));
      const keyMatches = keyText.length > 2 && normalizedValues.some((value) => value.includes(keyText) || keyText.includes(value));
      if (!labelMatches && !keyMatches) return undefined;

      const specificity = Math.max(labelMatches ? label.length : 0, keyMatches ? keyText.length : 0);
      const boundaryBonus = normalizedValues.some((value) => value.endsWith(label) || value.startsWith(label)) ? 25 : 0;
      return { definition, score: specificity + boundaryBonus };
    })
    .filter((match): match is { definition: AttributeDefinition; score: number } => Boolean(match))
    .sort((a, b) => b.score - a.score || b.definition.label.length - a.definition.label.length);

  return rankedMatches[0]?.definition;
}

function normalizedHeaderCandidates(header: string) {
  const normalized = normalizeDictionaryHeader(header);
  const candidates = new Set([normalized]);
  candidates.add(normalized.replace(/^avg/, 'average'));
  candidates.add(normalized.replace(/avg/g, 'average'));
  return Array.from(candidates);
}

export function makeAttributeKey(field: string) {
  return field.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function toAttributeType(type = ''): AttributeType {
  const normalized = type.toLowerCase();
  if (normalized.includes('boolean') || normalized.includes('y/n')) return 'boolean';
  if (normalized.includes('integer') || normalized.includes('number') || normalized.includes('len()')) return 'number';
  if (normalized.includes('email')) return 'text';
  if (normalized.includes('list') || normalized.includes('multiple')) return 'multi-select';
  if (normalized.includes('standard') || normalized.includes('specialised')) return 'select';
  return 'text';
}

function downstreamSystemsForGroup(group: string, field: string) {
  const text = `${group} ${field}`.toLowerCase();
  const systems = new Set<string>();
  if (text.includes('archibus')) systems.add('Archibus');
  if (text.includes('timetable') || text.includes('teaching')) systems.add('Timetabling');
  if (text.includes('outlook') || text.includes('azure') || text.includes('mtr') || text.includes('booking')) systems.add('O365');
  if (text.includes('appspace')) systems.add('Appspace');
  if (text.includes('momentus')) systems.add('Momentus');
  if (text.includes('hector')) systems.add('Hector');
  if (text.includes('lock') || text.includes('proficiency')) systems.add('Security/access');
  if (text.includes('av') || text.includes('amenity') || text.includes('piano') || text.includes('bench')) systems.add('Maintenance');
  return Array.from(systems);
}

function optionsForField(field: string) {
  if (field.includes('TYPE (Standard')) return ['Standard', 'Specialised'];
  if (field.includes('PREDOMINANT COMPUTE')) return ['Windows', 'Mac', 'None'];
  if (field.includes('FLOOR TYPE')) return ['Flat floor', 'Tiered floor', 'Sprung floor'];
  return undefined;
}

function isRequiredDictionaryField(field: string) {
  return ['ARCHIBUS ID', 'CAMPUS ID', 'BUILDING ID', 'ROOM ID', 'ROOM NUMBER', 'FINAL ROOM NAME'].includes(field);
}
