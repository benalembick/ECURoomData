import { ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import { z } from 'zod';
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  GitBranch,
  History,
  Home,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  ListChecks,
  LockKeyhole,
  Map as MapIcon,
  Maximize2,
  Minus,
  Move,
  Pencil,
  MessageSquare,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import {
  attributeDefinitions as initialAttributeDefinitions,
  buildings as initialBuildings,
  campuses as initialCampuses,
  categories,
  changeRequests as initialChangeRequests,
  mappings,
  patterns as initialPatterns,
  rooms as initialRooms,
  transformationRules,
} from './data/mockData';
import type { AttributeDefinition, AttributeGroup, Building, BusinessUnit, Campus, ChangeRequest, DatabaseRole, GovernanceRequestType, GovernanceRule, GovernanceSystem, GovernanceTemplate, ImportPreviewRow, Issue, IssueAttachmentReference, IssueCategory, IssueComment, IssueStatus, Room, RoomPattern, RuleEvaluationResult, TaskStatus, UserProfile } from './types';
import { evaluateGovernanceRules, loadGovernanceRequestTypes, loadGovernanceRules, loadGovernanceSystems, loadGovernanceTemplates, saveGovernanceRule, deleteGovernanceRule, saveRuleConditionsAndActions, saveGovernanceTemplate, deleteGovernanceTemplate, saveTemplateTask, deleteTemplateTask, saveGovernanceRequestType, deleteGovernanceRequestType, saveGovernanceSystem, deleteGovernanceSystem, saveChangeRequest } from './services/governanceService';
import { cn, downloadCsv, titleCase } from './lib/utils';
import { buildingDisplayName, floorNameFromCode, parseRoomCode } from './lib/roomCode';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { persistImportToSupabase, type PersistImportProgress, type PersistImportResult } from './services/importPersistence';
import { persistBuildingDetails, persistBuildingRemoval, persistCampusDetails, persistCampusMapping, persistCampusRemoval, type CampusMappingProgress } from './services/campusPersistence';
import { createDataBackup, deleteDataBackup, getBackupOperation, listDataBackups, restoreDataBackup, type BackupOperation, type DataBackupSet } from './services/dataBackups';
import { createAttributeGroup, deleteAttributeGroup, moveAttributeDefinitionsToGroup, renameAttributeGroup } from './services/fieldManagement';
import { deleteSharedFloorplanFromSupabase, loadSharedFloorplansFromSupabase, saveSharedFloorplanToSupabase } from './services/floorplanPersistence';
import { loadRoomDataFromSupabase, type RoomDataLoadProgress } from './services/roomData';
import { getCurrentUserProfile, listUserProfiles, saveUserProfile, type SaveUserPayload } from './services/userManagement';
import {
  coreRoomFieldOptions,
  compareRoomDataDictionaryGroups,
  findAttributeDefinitionForHeader,
  makeAttributeKey,
  roomDataDictionaryByKey,
  roomDataDictionaryDefinitions,
} from './data/roomDataDictionary';
import { floorplans, type FloorplanDefinition, type FloorplanHotspot, type FloorplanZone } from './data/floorplans';
import {
  importedIssues,
  issueAttachmentReferences as initialIssueAttachmentReferences,
  issueBusinessUnits as initialIssueBusinessUnits,
  issueCategories as initialIssueCategories,
  issuesImportSummary,
  issueStatuses as initialIssueStatuses,
} from './data/issuesRegister';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

type View =
  | 'dashboard'
  | 'issues-dashboard'
  | 'issues'
  | 'issue-change-requests'
  | 'issue-defects'
  | 'issue-reports'
  | 'issue-admin'
  | 'rooms'
  | 'floorplans'
  | 'room-detail'
  | 'admin'
  | 'data-fields'
  | 'locations'
  | 'patterns'
  | 'rules'
  | 'governance'
  | 'import'
  | 'backups'
  | 'users';

type ImportStage = 'upload' | 'mapping' | 'approval';

const roomSchema = z.object({
  roomCode: z.string().min(3),
  name: z.string().min(2),
  campus: z.string().min(1),
  building: z.string().min(1),
  capacity: z.coerce.number().int().nonnegative(),
  owner: z.string().min(1),
  pattern: z.string().min(1),
});

const navItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home },
  { id: 'rooms', label: 'Room Search', icon: Search },
  { id: 'floorplans', label: 'Floorplans', icon: MapIcon },
  { id: 'admin', label: 'Room Admin', icon: Settings2 },
  { id: 'data-fields', label: 'Data Fields', icon: Database },
  { id: 'locations', label: 'Campuses', icon: Building2 },
  { id: 'patterns', label: 'Patterns', icon: Layers3 },
  { id: 'rules', label: 'Rules', icon: GitBranch },
  { id: 'governance', label: 'Governance', icon: ClipboardCheck },
];

const adminViews: View[] = ['import', 'backups', 'users'];
const adminNavItems: { id: View; label: string; icon: typeof Home; adminOnly: boolean }[] = [
  { id: 'import', label: 'Import', icon: FileSpreadsheet, adminOnly: false },
  { id: 'backups', label: 'Backups', icon: Archive, adminOnly: true },
  { id: 'users', label: 'Users', icon: Users, adminOnly: true },
];

const issueTrackerViews: View[] = ['issues-dashboard', 'issues', 'issue-change-requests', 'issue-defects', 'issue-reports', 'issue-admin'];
const issueTrackerNavItems: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'issues-dashboard', label: 'Issue Dashboard', icon: AlertTriangle },
  { id: 'issues', label: 'All Issues', icon: ListChecks },
  { id: 'issue-change-requests', label: 'Change Requests', icon: GitBranch },
  { id: 'issue-defects', label: 'Defects', icon: Wrench },
  { id: 'issue-reports', label: 'Issue Reports', icon: FileText },
  { id: 'issue-admin', label: 'Issue Admin', icon: Settings2 },
];

const ecuLogoUrl = 'https://www.ecu.edu.au/__data/assets/image/0004/1100389/ecu-logo.png';
const customImportFieldGroup = 'Custom fields';
const finalRoomNameAttributeKey = 'final_room_name';
const roomCapacityAttributeKeys = ['capacity_afm_rm_capacity', 'capacity'];
const roomCapacityAttributeLabels = ['Capacity (Afm.rm.capacity)', 'CAPACITY'];
const roomSearchRenderLimit = 250;
const maxFloorplanImageBytes = 900 * 1024;
const roomFloorplanManifestUrl = '/room-floorplans/manifest.json';
const roomFloorplanThumbnailPath = '/room-floorplan-thumbnails/';
const roomQuickFilters = [
  { label: 'Create in Outlook', attributeKey: 'create_in_outlook' },
  { label: 'In Appspace', attributeKey: 'in_appspace_needs_to_be_confirmed' },
  { label: 'In Momentus', attributeKey: 'in_momentus' },
  { label: 'In Hector', attributeKey: 'in_hector' },
  { label: 'People counting', attributeKey: 'people_counting' },
  { label: 'Outlook available', attributeKey: 'outlook_booking_available' },
  { label: 'Appspace available', attributeKey: 'appspace_booking_available' },
  { label: 'Momentus available', attributeKey: 'momentus_booking_available' },
];
const impactedSystemSummaryRows = [
  { label: 'O365', matches: (room: Room) => isYesAttribute(room, 'create_in_outlook') },
  { label: 'Timetabling', matches: (room: Room) => isYesAttribute(room, 'is_teaching_space') },
  { label: 'Appspace', matches: (room: Room) => hasAttributeText(room, 'in_appspace_needs_to_be_confirmed', 'Appspace') },
  { label: 'Momentus', matches: (room: Room) => isYesAttribute(room, 'in_momentus') },
  { label: 'People Counting', matches: (room: Room) => isYesAttribute(room, 'people_counting') },
  { label: 'Allow Walk Up Bookings', matches: (room: Room) => isYesAttribute(room, 'room_booking_panel_allows_annonymous_walk_up') },
  { label: 'General Teaching Space (GTS)', matches: (room: Room) => hasAttributeText(room, 'timetable_room_pool_code_for_outlook_name', 'GTS') },
  { label: 'Specialised Teaching Space (STS)', matches: (room: Room) => hasAttributeText(room, 'timetable_room_pool_code_for_outlook_name', 'STS') },
  { label: 'Restricted Teaching Space (RTS)', matches: (room: Room) => hasAttributeText(room, 'timetable_room_pool_code_for_outlook_name', 'RTS') },
];

type ImportedRoomFields = Partial<
  Pick<Room, 'roomCode' | 'name' | 'campus' | 'building' | 'floor' | 'capacity' | 'owner' | 'pattern' | 'bookingStatus'>
> & {
  attributes?: Record<string, string | boolean | number | string[]>;
};

interface RoomFloorplanManifestEntry {
  room: string;
  filename: string;
}

let roomFloorplanMapPromise: Promise<Map<string, string> | null> | null = null;

function getRoomFinalName(room: Room) {
  const attributeValue = room.attributes[finalRoomNameAttributeKey];
  const dictionaryName = typeof attributeValue === 'string' ? attributeValue.trim() : '';
  const coreName = room.name.trim();
  if (dictionaryName && dictionaryName !== room.roomCode) return dictionaryName;
  if (coreName && coreName !== room.roomCode) return coreName;
  return '';
}

function isYesAttribute(room: Room, attributeKey: string) {
  const value = room.attributes[attributeKey];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (Array.isArray(value)) return value.some((item) => ['yes', 'y', 'true', '1'].includes(item.trim().toLowerCase()));
  return ['yes', 'y', 'true', '1'].includes(String(value ?? '').trim().toLowerCase());
}

function hasAttributeText(room: Room, attributeKey: string, expectedText: string) {
  const value = room.attributes[attributeKey];
  const expected = expectedText.trim().toLowerCase();
  if (Array.isArray(value)) return value.some((item) => item.trim().toLowerCase() === expected);
  return String(value ?? '').trim().toLowerCase() === expected;
}

function roomDisplayName(room: Room) {
  const finalName = getRoomFinalName(room);
  return finalName ? `${room.roomCode} - ${finalName}` : room.roomCode;
}

function roomDraftWithFinalName(room: Room): Room {
  const finalName = getRoomFinalName(room);
  return finalName ? { ...room, name: finalName } : room;
}

function readImageFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }

    if (file.size > maxFloorplanImageBytes) {
      reject(new Error('Please choose an image under 900 KB.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the selected image.'));
    };
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

async function loadRoomFloorplanMap() {
  if (roomFloorplanMapPromise) return roomFloorplanMapPromise;

  roomFloorplanMapPromise = fetch(roomFloorplanManifestUrl)
    .then(async (response) => {
      if (!response.ok) return null;
      const entries = await response.json() as RoomFloorplanManifestEntry[];
      const map = new Map<string, string>();

      entries.forEach((entry) => {
        if (!entry.room || !entry.filename) return;
        const filename = entry.filename;
        const url = `/room-floorplans/${encodeURIComponent(filename)}`;
        [entry.room, filename.replace(/\.[^.]+$/, '').split(' - ')[0], `CC.${entry.room}`].forEach((roomCode) => {
          map.set(normalizeRoomCodeKey(roomCode), url);
        });
      });

      return map;
    })
    .catch(() => null);

  return roomFloorplanMapPromise;
}

async function applyRoomFloorplanImages(rooms: Room[]) {
  const floorplanMap = await loadRoomFloorplanMap();
  if (!floorplanMap) return { rooms, matched: 0 };

  let matched = 0;
  const roomsWithFloorplans = rooms.map((room) => {
    if (room.floorplanImageUrl) return room;
    const floorplanImageUrl = roomFloorplanLookupKeys(room.roomCode)
      .map((key) => floorplanMap.get(key))
      .find(Boolean);
    if (!floorplanImageUrl) return room;
    matched += 1;
    return { ...room, floorplanImageUrl };
  });

  return { rooms: roomsWithFloorplans, matched };
}

function roomFloorplanLookupKeys(roomCode: string) {
  const normalized = normalizeRoomCodeKey(roomCode);
  const parts = normalized.split('.');
  return [
    normalized,
    parts.length > 2 ? parts.slice(1).join('.') : normalized,
  ];
}

function normalizeRoomCodeKey(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, '').replace(/^CC\./, '');
}

function getRoomFloorplanThumbnailUrl(imageUrl?: string) {
  if (!imageUrl) return undefined;
  const roomFloorplanPath = '/room-floorplans/';
  if (!imageUrl.startsWith(roomFloorplanPath)) return imageUrl;
  return `${roomFloorplanThumbnailPath}${imageUrl.slice(roomFloorplanPath.length)}`;
}

function getRoomCapacityValue(room: Room, attributes: AttributeDefinition[] = []) {
  const attributeEntry = Object.entries(room.attributes).find(([key]) => roomCapacityAttributeKeys.includes(key))
    ?? Object.entries(room.attributes).find(([key]) => {
      const definition = attributes.find((attribute) => attribute.key === key) ?? roomDataDictionaryByKey.get(key);
      return definition ? roomCapacityAttributeLabels.includes(definition.label) : false;
    });

  return attributeEntry?.[1] ?? room.capacity;
}

function getRoomCapacityNumber(room: Room, attributes: AttributeDefinition[] = []) {
  const value = getRoomCapacityValue(room, attributes);
  const parsed = Array.isArray(value) ? Number(value[0]) : Number(value);
  return Number.isFinite(parsed) ? parsed : room.capacity;
}

function getRoomCapacityDisplay(room: Room, attributes: AttributeDefinition[] = []) {
  return formatAttributeValue(getRoomCapacityValue(room, attributes));
}

function floorGroupLabel(room: Room) {
  return room.floor?.trim() || 'Unmapped Floor';
}

function floorDisplayName(floor: string) {
  const normalized = floor.trim().toLowerCase();
  if (['b', 'basement', 'level b', 'level basement'].includes(normalized)) return 'Level Basement';
  if (['g', 'ground', 'level g', 'level ground'].includes(normalized)) return 'Level Ground';
  if (['m', 'mezzanine', 'level m', 'level mezzanine'].includes(normalized)) return 'Level Mezzanine';
  return floor;
}

function floorSortValue(floor: string) {
  const normalized = floorDisplayName(floor).toLowerCase();
  if (normalized === 'level basement') return -60;
  if (normalized === 'level ground') return -50;
  if (normalized === 'level ground gallery') return -40;
  if (normalized === 'level ground mezzanine') return -30;
  if (normalized === 'level mezzanine') return -20;
  if (normalized === 'level mezzanine gallery') return -10;
  const exactLevel = normalized.match(/^level\s+(\d+)$/)?.[1];
  if (exactLevel) return Number(exactLevel);
  const galleryLevel = normalized.match(/^level\s+(\d+)\s+gallery$/)?.[1];
  if (galleryLevel) return Number(galleryLevel) + 0.5;
  return 1000;
}

function viewFromLocation(): View {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/issues') return 'issues-dashboard';
  if (path === '/issues/all') return 'issues';
  if (path === '/issues/change-requests') return 'issue-change-requests';
  if (path === '/issues/defects') return 'issue-defects';
  if (path === '/issues/reports') return 'issue-reports';
  if (path === '/issues/admin') return 'issue-admin';
  if (path === '/rooms') return 'rooms';
  if (path === '/floorplans') return 'floorplans';
  return 'dashboard';
}

function searchFromLocation() {
  return new URLSearchParams(window.location.search).get('search') ?? '';
}

type IssueListFilter = {
  query?: string;
  unit?: string;
  priority?: string;
  status?: string;
  category?: string;
  responsible?: string;
  quickFilter?: string;
};

export function App() {
  const [view, setView] = useState<View>(() => viewFromLocation());
  const [roomSearchQuery, setRoomSearchQuery] = useState(() => searchFromLocation());
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [campusesData, setCampusesData] = useState<Campus[]>(initialCampuses);
  const [buildingsData, setBuildingsData] = useState<Building[]>(initialBuildings);
  const [roomPatterns, setRoomPatterns] = useState<RoomPattern[]>(initialPatterns);
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>(initialAttributeDefinitions);
  const [attributeGroups, setAttributeGroups] = useState<AttributeGroup[]>(() => getAttributeGroupsFromDefinitions(initialAttributeDefinitions));
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(initialChangeRequests);
  const [governanceRequestTypes, setGovernanceRequestTypes] = useState<GovernanceRequestType[]>([]);
  const [governanceSystems, setGovernanceSystems] = useState<GovernanceSystem[]>([]);
  const [governanceRules, setGovernanceRules] = useState<GovernanceRule[]>([]);
  const [governanceTemplates, setGovernanceTemplates] = useState<GovernanceTemplate[]>([]);
  const [issues, setIssues] = useState<Issue[]>(importedIssues);
  const [issueBusinessUnits, setIssueBusinessUnits] = useState<BusinessUnit[]>(initialIssueBusinessUnits);
  const [issueCategoriesData, setIssueCategoriesData] = useState<IssueCategory[]>(initialIssueCategories);
  const [issueStatusesData, setIssueStatusesData] = useState<IssueStatus[]>(initialIssueStatuses);
  const [issueAttachments] = useState<IssueAttachmentReference[]>(initialIssueAttachmentReferences);
  const [issueListFilter, setIssueListFilter] = useState<IssueListFilter>({});
  const [selectedRoomId, setSelectedRoomId] = useState(initialRooms[0].id);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUserEmail, setAuthUserEmail] = useState('');
  const [authProfile, setAuthProfile] = useState<UserProfile | null>(null);
  const [authMessage, setAuthMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authInitializing, setAuthInitializing] = useState(isSupabaseConfigured);
  const [authRequiredMessage, setAuthRequiredMessage] = useState('');
  const [dataMessage, setDataMessage] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoadProgress, setDataLoadProgress] = useState<RoomDataLoadProgress | null>(null);
  const [summaryFilter, setSummaryFilter] = useState<string | null>(null);
  const [hasLoadedRoomData, setHasLoadedRoomData] = useState(false);
  const roomDataLoadRef = useRef<Promise<void> | null>(null);
  const roomDataLoading = isSupabaseConfigured && dataLoading && !hasLoadedRoomData;
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];
  const canEdit = !isSupabaseConfigured || authProfile?.role === 'room_data_editor' || authProfile?.role === 'admin';
  const canManageUsers = authProfile?.role === 'admin';
  const canManageFieldConfig = !isSupabaseConfigured || canManageUsers;
  const visibleNavItems = navItems.filter((item) => item.id !== 'data-fields' || canManageFieldConfig);

  const navigateToView = useCallback((nextView: View, searchValue = '') => {
    setView(nextView);
    if (nextView === 'rooms') {
      setRoomSearchQuery(searchValue);
      const query = searchValue ? `?search=${encodeURIComponent(searchValue)}` : '';
      window.history.pushState({}, '', `/rooms${query}`);
      return;
    }
    if (nextView === 'floorplans') {
      window.history.pushState({}, '', '/floorplans');
      return;
    }
    const issuePaths: Partial<Record<View, string>> = {
      'issues-dashboard': '/issues',
      issues: '/issues/all',
      'issue-change-requests': '/issues/change-requests',
      'issue-defects': '/issues/defects',
      'issue-reports': '/issues/reports',
      'issue-admin': '/issues/admin',
    };
    if (issuePaths[nextView]) {
      window.history.pushState({}, '', issuePaths[nextView]);
      return;
    }
    window.history.pushState({}, '', '/');
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromLocation());
      setRoomSearchQuery(searchFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const refreshRoomData = useCallback(async () => {
    if (!supabase) return;
    if (roomDataLoadRef.current) return roomDataLoadRef.current;

    setDataLoading(true);
    setDataLoadProgress({ percent: 0, completedSteps: 0, totalSteps: 6, message: 'Connecting to Supabase' });
    setDataMessage('');
    const loadPromise = Promise.resolve().then(async () => {
      const loaded = await loadRoomDataFromSupabase(setDataLoadProgress);
      if (loaded) {
        const floorplanResult = await applyRoomFloorplanImages(loaded.rooms);
        setRooms(floorplanResult.rooms);
        setCampusesData(loaded.campuses);
        setBuildingsData(loaded.buildings);
        setRoomPatterns(loaded.patterns.length ? loaded.patterns : initialPatterns);
        setAttributeDefinitions(loaded.attributes.length ? loaded.attributes : initialAttributeDefinitions);
        setAttributeGroups(mergeAttributeGroups(loaded.attributeGroups, getAttributeGroupsFromDefinitions(loaded.attributes)));
        setHasLoadedRoomData(true);
        setSelectedRoomId((currentRoomId) =>
          loaded.rooms.length && !loaded.rooms.some((room) => room.id === currentRoomId) ? loaded.rooms[0].id : currentRoomId,
        );
        setDataMessage(`Loaded ${loaded.rooms.length} room(s) from Supabase. Matched ${floorplanResult.matched} floorplan image(s).`);
      }

    });

    roomDataLoadRef.current = loadPromise;
    try {
      await loadPromise;
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : 'Could not load room data from Supabase.');
    } finally {
      if (roomDataLoadRef.current === loadPromise) roomDataLoadRef.current = null;
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const supabaseClient = supabase;

    const applySessionUser = async (email?: string | null) => {
      setAuthUserEmail(email ?? '');
      if (!email) {
        setAuthProfile(null);
        setHasLoadedRoomData(false);
        setAuthInitializing(false);
        return;
      }

      const profile = await getCurrentUserProfile();
      if (profile?.isDisabled) {
        await supabaseClient.auth.signOut();
        setAuthUserEmail('');
        setAuthProfile(null);
        setAuthMessage('This account has been disabled.');
        setAuthInitializing(false);
        return;
      }
      setAuthProfile(profile);
      setAuthInitializing(false);
      void refreshRoomData();
      const { data: savedColours, error: coloursError } = await supabaseClient.from('business_units').select('name, reference_colour');
      if (!coloursError && savedColours?.length) {
        const colourByName = new Map(savedColours.map((row) => [row.name as string, row.reference_colour as string]));
        setIssueBusinessUnits((units) => units.map((unit) => colourByName.has(unit.name) ? { ...unit, colour: colourByName.get(unit.name)! } : unit));
        setIssues((current) => current.map((issue) => {
          const colour = colourByName.get(issue.businessUnitName);
          return colour ? { ...issue, businessUnitColour: colour } : issue;
        }));
      }
      const [govTypes, govSystems, govRules, govTemplates] = await Promise.allSettled([
        loadGovernanceRequestTypes(),
        loadGovernanceSystems(),
        loadGovernanceRules(),
        loadGovernanceTemplates(),
      ]);
      if (govTypes.status === 'fulfilled') setGovernanceRequestTypes(govTypes.value);
      if (govSystems.status === 'fulfilled') setGovernanceSystems(govSystems.value);
      if (govRules.status === 'fulfilled') setGovernanceRules(govRules.value);
      if (govTemplates.status === 'fulfilled') setGovernanceTemplates(govTemplates.value);
    };

    supabaseClient.auth.getSession().then(({ data }) => {
      void applySessionUser(data.session?.user.email);
    }).catch(() => {
      setAuthInitializing(false);
    });

    const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      void applySessionUser(session?.user.email);
      if (session?.user.email) setAuthMessage('');
    });

    return () => listener.subscription.unsubscribe();
  }, [refreshRoomData]);

  const signIn = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    setAuthMessage('');
    const { error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword,
    });
    setAuthLoading(false);
    if (error) setAuthMessage(error.message);
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUserEmail('');
    setAuthProfile(null);
    setAuthPassword('');
    setRooms(initialRooms);
    setCampusesData(initialCampuses);
    setBuildingsData(initialBuildings);
    setRoomPatterns(initialPatterns);
    setAttributeDefinitions(initialAttributeDefinitions);
    setAttributeGroups(getAttributeGroupsFromDefinitions(initialAttributeDefinitions));
    setHasLoadedRoomData(false);
    setDataMessage('');
    setView('dashboard');
    setAuthMessage('Signed out.');
  };

  const requireAuthenticatedEdit = useCallback((action = 'save changes') => {
    if (!isSupabaseConfigured) return true;
    if (!authUserEmail) {
      setAuthRequiredMessage(`Please sign in before you ${action}.`);
      return false;
    }
    if (!canEdit) {
      setAuthRequiredMessage('Your account is readonly. Ask an admin to enable editing before making this change.');
      return false;
    }
    return true;
  }, [authUserEmail, canEdit]);

  if (isSupabaseConfigured && (!authUserEmail || authInitializing)) {
    return (
      <LoginPage
        email={authEmail}
        password={authPassword}
        message={authMessage}
        loading={authLoading || authInitializing}
        setEmail={setAuthEmail}
        setPassword={setAuthPassword}
        signIn={signIn}
      />
    );
  }

  const openRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    setView('room-detail');
  };

  const openRoomAdmin = (roomId: string) => {
    setSelectedRoomId(roomId);
    setView('admin');
  };

  const openSummarySearch = (summaryLabel: string) => {
    setSummaryFilter(summaryLabel);
    navigateToView('rooms');
  };

  const openRoomSearchForCode = (roomCode: string) => {
    setSummaryFilter(null);
    navigateToView('rooms', roomCode);
  };

  const openRoomProfileForCode = (roomCode: string) => {
    const matchingRoom = rooms.find((room) => normalizeRoomCodeKey(room.roomCode) === normalizeRoomCodeKey(roomCode));
    if (!matchingRoom) {
      openRoomSearchForCode(roomCode);
      return;
    }
    setSelectedRoomId(matchingRoom.id);
    setView('room-detail');
  };

  return (
    <div className="min-h-screen bg-ecu-mist">
      <header className="border-b border-slate-200 bg-white">
        <div className="h-1 bg-ecu-teal" />
        <div className="grid min-h-[134px] grid-cols-1 items-start px-4 sm:px-6 lg:grid-cols-[248px_1fr] lg:px-0">
          <div className="flex h-[134px] items-center justify-center">
            <div className="h-[96px] w-[132px] overflow-hidden">
              <img src={ecuLogoUrl} alt="Edith Cowan University" className="h-full w-full object-contain" />
            </div>
          </div>
          <div className="flex min-h-[134px] items-center justify-between border-t border-slate-100 lg:border-l lg:border-t-0 lg:px-20">
            <div>
              <p className="text-[1rem] font-semibold uppercase tracking-wide text-ecu-green">Digital Campus Operations</p>
              <h1 className="text-[1.667rem] font-bold text-ecu-black">Room Data Hub</h1>
            </div>
            <div className="hidden items-center gap-3 md:flex">
              <span className={cn('badge', isSupabaseConfigured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
                {isSupabaseConfigured ? 'Supabase connected' : 'Demo data mode'}
              </span>
              <SupabaseAuthControls
                email={authEmail}
                password={authPassword}
                userEmail={authUserEmail}
                profile={authProfile}
                message={authMessage}
                loading={authLoading}
                setEmail={setAuthEmail}
                setPassword={setAuthPassword}
                signIn={signIn}
                signOut={signOut}
                refreshRoomData={refreshRoomData}
                dataLoading={dataLoading}
              />
            </div>
          </div>
        </div>
      </header>

      {dataMessage && (
        <div className={cn('border-b px-4 py-2 text-sm lg:px-8', dataMessage.startsWith('Loaded') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700')}>
          {dataMessage}
        </div>
      )}

      {dataLoading && dataLoadProgress && (
        <DataLoadProgressBanner progress={dataLoadProgress} />
      )}

      <div className="grid min-h-[calc(100vh-139px)] grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <nav className="flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'rooms') setSummaryFilter(null);
                    navigateToView(item.id);
                  }}
                  className={cn(
                    'flex min-w-fit items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition lg:w-full',
                    view === item.id || (view === 'room-detail' && item.id === 'rooms')
                      ? 'bg-ecu-mint text-ecu-black'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                  )}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
            <div className="min-w-fit pt-1 lg:w-full lg:border-t lg:border-slate-200 lg:pt-3">
              <button
                type="button"
                onClick={() => navigateToView('import')}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition',
                  adminViews.includes(view)
                    ? 'bg-ecu-mint text-ecu-black'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                )}
              >
                <ShieldCheck size={18} />
                <span className="flex-1 text-left">Admin</span>
                {adminViews.includes(view) && <ChevronDown size={15} />}
              </button>
              {adminViews.includes(view) && (
                <div className="mt-1 flex gap-1 pl-2 lg:block lg:space-y-1 lg:pl-6">
                  {adminNavItems.filter((item) => !item.adminOnly || canManageUsers).map((subItem) => {
                    const SubIcon = subItem.icon;
                    return (
                      <button
                        key={subItem.id}
                        type="button"
                        onClick={() => navigateToView(subItem.id)}
                        className={cn(
                          'flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition lg:w-full',
                          view === subItem.id
                            ? 'bg-white text-ecu-black ring-1 ring-ecu-teal/30'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950',
                        )}
                      >
                        <SubIcon size={15} />
                        {subItem.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="min-w-fit pt-1 lg:w-full lg:border-t lg:border-slate-200 lg:pt-3">
              <button
                type="button"
                onClick={() => navigateToView('issues-dashboard')}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition',
                  issueTrackerViews.includes(view)
                    ? 'bg-ecu-mint text-ecu-black'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                )}
              >
                <AlertTriangle size={18} />
                <span className="flex-1 text-left">Issue tracker</span>
                {issueTrackerViews.includes(view) && <ChevronDown size={15} />}
              </button>
              {issueTrackerViews.includes(view) && (
                <div className="mt-1 flex gap-1 pl-2 lg:block lg:space-y-1 lg:pl-6">
                  {issueTrackerNavItems.map((subItem) => {
                    const SubIcon = subItem.icon;
                    return (
                      <button
                        key={subItem.id}
                        type="button"
                        onClick={() => navigateToView(subItem.id)}
                        className={cn(
                          'flex min-w-fit items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition lg:w-full',
                          view === subItem.id
                            ? 'bg-white text-ecu-black ring-1 ring-ecu-teal/30'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950',
                        )}
                      >
                        <SubIcon size={15} />
                        {subItem.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>
          <div className="hidden border-t border-slate-200 p-4 text-sm text-slate-600 lg:block">
            <p className="font-semibold text-ecu-black">Role model</p>
            <p className="mt-1">Viewer, editor, system owner, approver, and admin permissions are represented in the schema and UI.</p>
          </div>
        </aside>

        <main className="p-4 sm:p-6 lg:p-8">
          {view === 'dashboard' && <Dashboard rooms={rooms} changeRequests={changeRequests} openRoom={openRoom} openSummarySearch={openSummarySearch} roomDataLoading={roomDataLoading} />}
          {view === 'issues-dashboard' && (
            <IssuesDashboard
              issues={issues}
              businessUnits={issueBusinessUnits}
              categories={issueCategoriesData}
              statuses={issueStatusesData}
              openAllIssues={() => {
                setIssueListFilter({});
                navigateToView('issues');
              }}
              openFilteredIssues={(filter) => {
                setIssueListFilter(filter);
                navigateToView('issues');
              }}
            />
          )}
          {view === 'issues' && (
            <IssuesRegisterPage
              mode="all"
              issues={issues}
              setIssues={setIssues}
              businessUnits={issueBusinessUnits}
              categories={issueCategoriesData}
              statuses={issueStatusesData}
              attachments={issueAttachments}
              rooms={rooms}
              openRoomProfile={openRoomProfileForCode}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
              initialFilter={issueListFilter}
            />
          )}
          {view === 'issue-change-requests' && (
            <IssuesRegisterPage
              mode="change-requests"
              issues={issues}
              setIssues={setIssues}
              businessUnits={issueBusinessUnits}
              categories={issueCategoriesData}
              statuses={issueStatusesData}
              attachments={issueAttachments}
              rooms={rooms}
              openRoomProfile={openRoomProfileForCode}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
              initialFilter={issueListFilter}
            />
          )}
          {view === 'issue-defects' && (
            <IssuesRegisterPage
              mode="defects"
              issues={issues}
              setIssues={setIssues}
              businessUnits={issueBusinessUnits}
              categories={issueCategoriesData}
              statuses={issueStatusesData}
              attachments={issueAttachments}
              rooms={rooms}
              openRoomProfile={openRoomProfileForCode}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
              initialFilter={issueListFilter}
            />
          )}
          {view === 'issue-reports' && <IssueReports issues={issues} businessUnits={issueBusinessUnits} categories={issueCategoriesData} statuses={issueStatusesData} />}
          {view === 'issue-admin' && (
            <IssueAdmin
              businessUnits={issueBusinessUnits}
              setBusinessUnits={setIssueBusinessUnits}
              categories={issueCategoriesData}
              setCategories={setIssueCategoriesData}
              statuses={issueStatusesData}
              setStatuses={setIssueStatusesData}
              issues={issues}
              setIssues={setIssues}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
            />
          )}
          {view === 'rooms' && <RoomSearch rooms={rooms} campuses={campusesData} attributes={attributeDefinitions} openRoom={openRoom} roomDataLoading={roomDataLoading} loadProgress={dataLoadProgress} summaryFilter={summaryFilter} clearSummaryFilter={() => setSummaryFilter(null)} initialSearch={roomSearchQuery} />}
          {view === 'floorplans' && <FloorplansPage rooms={rooms} campuses={campusesData} buildings={buildingsData} openRoomProfile={openRoomProfileForCode} />}
          {view === 'room-detail' && <RoomDetail room={selectedRoom} rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} openRoomAdmin={openRoomAdmin} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'admin' && <Admin rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} campuses={campusesData} buildings={buildingsData} patterns={roomPatterns} initialRoomId={selectedRoomId} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'data-fields' && canManageFieldConfig && <DataFieldManagement attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} groups={attributeGroups} setGroups={setAttributeGroups} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'locations' && <CampusManagement rooms={rooms} setRooms={setRooms} campuses={campusesData} setCampuses={setCampusesData} buildings={buildingsData} setBuildings={setBuildingsData} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'patterns' && <Patterns rooms={rooms} setRooms={setRooms} patterns={roomPatterns} setPatterns={setRoomPatterns} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'rules' && (
            <GovernanceRulesAdmin
              requestTypes={governanceRequestTypes}
              setRequestTypes={setGovernanceRequestTypes}
              systems={governanceSystems}
              setSystems={setGovernanceSystems}
              rules={governanceRules}
              setRules={setGovernanceRules}
              templates={governanceTemplates}
              setTemplates={setGovernanceTemplates}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
              canManage={canManageUsers}
            />
          )}
          {view === 'governance' && (
            <Governance
              requests={changeRequests}
              setRequests={setChangeRequests}
              rooms={rooms}
              requestTypes={governanceRequestTypes}
              rules={governanceRules}
              systems={governanceSystems}
              templates={governanceTemplates}
              requireAuthenticatedEdit={requireAuthenticatedEdit}
            />
          )}
          {view === 'import' && <ImportWizard rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} refreshRoomData={refreshRoomData} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'backups' && canManageUsers && <DataBackups refreshRoomData={refreshRoomData} />}
          {view === 'users' && canManageUsers && <UserManagement currentUser={authProfile} />}
        </main>
      </div>
      {authRequiredMessage && (
        <AuthRequiredOverlay
          message={authRequiredMessage}
          onClose={() => setAuthRequiredMessage('')}
        />
      )}
    </div>
  );
}

function LoginPage({
  email,
  password,
  message,
  loading,
  setEmail,
  setPassword,
  signIn,
}: {
  email: string;
  password: string;
  message: string;
  loading: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  signIn: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email || !password || loading) return;
    signIn();
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-ecu-mist p-4">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel lg:grid-cols-[0.95fr_1.05fr]">
        <div className="flex min-h-[520px] flex-col justify-between bg-ecu-black p-8 text-white">
          <div>
            <div className="h-[92px] w-[128px] overflow-hidden rounded-md bg-white p-3">
              <img src={ecuLogoUrl} alt="Edith Cowan University" className="h-full w-full object-contain" />
            </div>
            <p className="mt-10 text-sm font-semibold uppercase tracking-wide text-ecu-mint">Digital Campus Operations</p>
            <h1 className="mt-3 text-3xl font-bold">Room Data Hub</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-200">
              Sign in to view room data, floorplans, governance status, and import workflows.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-slate-200">
            <div className="flex items-center gap-2"><ShieldCheck size={16} /> Readonly users can inspect room data.</div>
            <div className="flex items-center gap-2"><Pencil size={16} /> Edit-enabled users can update governed records.</div>
            <div className="flex items-center gap-2"><Users size={16} /> Admins can manage user access.</div>
          </div>
        </div>

        <form className="flex min-h-[520px] flex-col justify-center p-8 sm:p-12" onSubmit={submit}>
          <div className="mb-8">
            <div className="inline-flex rounded-md bg-ecu-mint p-3 text-ecu-black">
              <LockKeyhole size={24} />
            </div>
            <h2 className="mt-5 text-2xl font-bold text-slate-950">Sign in</h2>
            <p className="mt-2 text-sm text-slate-600">Use your assigned Room Data Hub account.</p>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="label">Email</span>
              <input className="input mt-1" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input className="input mt-1" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          </div>

          {message && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}

          <button className="btn-primary mt-6 w-full" type="submit" disabled={loading || !email || !password}>
            {loading ? 'Checking access...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

function AuthRequiredOverlay({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-amber-50 p-2 text-amber-700">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-950">Sign in required</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button className="btn-primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Home; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-8 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
        <Icon size={24} />
      </div>
      <p className="font-semibold text-slate-700">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-slate-400">{description}</p>
    </div>
  );
}

function ErrorMessage({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{message}</span>
      <button type="button" className="shrink-0 font-bold hover:text-red-900" onClick={onClose}>×</button>
    </div>
  );
}

function SupabaseAuthControls({
  email,
  password,
  userEmail,
  profile,
  message,
  loading,
  setEmail,
  setPassword,
  signIn,
  signOut,
  refreshRoomData,
  dataLoading,
}: {
  email: string;
  password: string;
  userEmail: string;
  profile: UserProfile | null;
  message: string;
  loading: boolean;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  signIn: () => void;
  signOut: () => void;
  refreshRoomData: () => void;
  dataLoading: boolean;
}) {
  if (!isSupabaseConfigured) {
    return (
      <span className="badge border-slate-200 bg-slate-50 text-slate-700">
        <ShieldCheck size={14} /> Demo
      </span>
    );
  }

  if (userEmail) {
    return (
      <div className="flex items-center gap-2">
        <span className="badge border-emerald-200 bg-emerald-50 text-emerald-700">
          <ShieldCheck size={14} /> {userEmail} · {roleLabel(profile?.role ?? 'viewer')}
        </span>
        <button className="btn-secondary py-1 text-xs" disabled={dataLoading} onClick={refreshRoomData}>
          <RefreshCcw size={14} /> {dataLoading ? 'Loading...' : 'Reload data'}
        </button>
        <button className="btn-secondary py-1 text-xs" onClick={signOut}>Sign out</button>
      </div>
    );
  }

  return (
    <div className="flex max-w-[520px] flex-wrap items-center justify-end gap-2">
      <button className="btn-secondary h-9 px-3 py-1 text-xs" disabled={dataLoading} onClick={refreshRoomData}>
        <RefreshCcw size={14} /> {dataLoading ? 'Loading...' : 'Reload data'}
      </button>
      <input
        className="input h-9 w-44"
        type="email"
        placeholder="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        className="input h-9 w-36"
        type="password"
        placeholder="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button className="btn-primary h-9 px-3 py-1 text-xs" disabled={loading || !email || !password} onClick={signIn}>
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
      {message && <p className="w-full text-right text-xs text-red-600">{message}</p>}
    </div>
  );
}

const managedRoleOptions: { value: DatabaseRole; label: string; detail: string }[] = [
  { value: 'viewer', label: 'Readonly', detail: 'Can sign in and view room data.' },
  { value: 'room_data_editor', label: 'Edit enabled', detail: 'Can update room data, locations, imports, and governance items.' },
  { value: 'admin', label: 'Admin', detail: 'Can edit data and manage user access.' },
];

function roleLabel(role: DatabaseRole) {
  return managedRoleOptions.find((option) => option.value === role)?.label ?? titleCase(role.replace(/_/g, ' '));
}

function UserManagement({ currentUser }: { currentUser: UserProfile | null }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveUserPayload>({
    email: '',
    displayName: '',
    role: 'viewer',
    businessUnit: '',
    isDisabled: false,
    password: '',
  });

  const selectedUser = users.find((user) => user.id === selectedId) ?? null;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await listUserProfiles());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const selectUser = (user: UserProfile) => {
    setSelectedId(user.id);
    setDraft({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      businessUnit: user.businessUnit ?? '',
      isDisabled: user.isDisabled ?? false,
      password: '',
    });
    setMessage('');
    setError('');
  };

  const startNewUser = () => {
    setSelectedId(null);
    setDraft({ email: '', displayName: '', role: 'viewer', businessUnit: '', isDisabled: false, password: '' });
    setMessage('');
    setError('');
  };

  const saveUser = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await saveUserProfile(draft);
      setUsers((current) => {
        const exists = current.some((user) => user.id === saved.id);
        return exists
          ? current.map((user) => (user.id === saved.id ? saved : user))
          : [...current, saved].sort((a, b) => a.displayName.localeCompare(b.displayName));
      });
      setSelectedId(saved.id);
      setDraft({ ...draft, id: saved.id, isDisabled: saved.isDisabled, password: '' });
      setMessage(`${saved.displayName} is now ${saved.isDisabled ? 'disabled' : roleLabel(saved.role).toLowerCase()}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save user.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = draft.email.trim() && draft.displayName.trim() && (draft.id || draft.password?.trim());

  return (
    <>
      <PageHeader
        title="User Management"
        description="Set up Room Data Hub users as readonly, edit enabled, or admin accounts."
        action={<button className="btn-primary" onClick={startNewUser}><UserPlus size={16} /> New user</button>}
      />

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel rounded-lg">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Users</h3>
            <button className="btn-secondary py-1 text-xs" onClick={loadUsers} disabled={loading}>
              <RefreshCcw size={14} /> {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {loading && <div className="p-4"><LoadingPanelMessage label="Loading users" /></div>}
            {!loading && users.map((user) => (
              <button
                key={user.id}
                className={cn('block w-full px-4 py-3 text-left transition hover:bg-slate-50', selectedId === user.id && 'bg-ecu-mint')}
                onClick={() => selectUser(user)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{user.displayName}</p>
                    <p className="text-sm text-slate-600">{user.email}</p>
                  </div>
                  <span className={cn(
                    'badge',
                    user.isDisabled && 'border-red-200 bg-red-50 text-red-700',
                    !user.isDisabled && user.role === 'viewer' && 'border-slate-200 bg-slate-50 text-slate-700',
                    !user.isDisabled && user.role === 'room_data_editor' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                    !user.isDisabled && user.role === 'admin' && 'border-purple-200 bg-purple-50 text-purple-700',
                  )}>
                    {user.isDisabled ? 'Disabled' : roleLabel(user.role)}
                  </span>
                </div>
              </button>
            ))}
            {!loading && !users.length && <p className="p-4 text-sm text-slate-600">No user profiles found.</p>}
          </div>
        </div>

        <div className="panel rounded-lg p-5">
          <div className="mb-5">
            <h3 className="text-lg font-bold text-slate-950">{selectedUser ? 'Edit user access' : 'Create user'}</h3>
            <p className="mt-1 text-sm text-slate-600">
              {currentUser?.email ? `Signed in as ${currentUser.email}.` : 'Only admins can save user changes.'}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Display name" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value })} />
            <TextInput label="Email" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
            <label className="block sm:col-span-2">
              <span className="label">Access</span>
              <select className="input mt-1" value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as DatabaseRole })}>
                {managedRoleOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{managedRoleOptions.find((option) => option.value === draft.role)?.detail}</p>
            </label>
            <TextInput label="Business unit" value={draft.businessUnit ?? ''} onChange={(value) => setDraft({ ...draft, businessUnit: value })} />
            <label className="block">
              <span className="label">{draft.id ? 'New password' : 'Temporary password'}</span>
              <input
                className="input mt-1"
                type="password"
                value={draft.password ?? ''}
                placeholder={draft.id ? 'Leave blank to keep current password' : ''}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            </label>
            <label className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <input
                className="mt-1 h-4 w-4 accent-ecu-teal"
                type="checkbox"
                checked={Boolean(draft.isDisabled)}
                onChange={(event) => setDraft({ ...draft, isDisabled: event.target.checked })}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Disable sign-in</span>
                <span className="block text-xs leading-5 text-slate-600">Disabled users stay in the user list but cannot sign in until re-enabled.</span>
              </span>
            </label>
          </div>

          {message && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div className="mt-6 flex justify-end">
            <button className="btn-primary" disabled={saving || !canSave} onClick={saveUser}>
              <CheckCircle2 size={16} /> {saving ? 'Saving...' : 'Save user'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function DataBackups({ refreshRoomData }: { refreshRoomData: () => Promise<void> }) {
  const [backups, setBackups] = useState<DataBackupSet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState(() => `Room data backup ${formatBackupDate(new Date().toISOString())}`);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeOperation, setActiveOperation] = useState<BackupOperation | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedBackup = backups.find((backup) => backup.id === selectedId) ?? backups[0] ?? null;

  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const loaded = await listDataBackups();
      setBackups(loaded);
      setSelectedId((current) => current && loaded.some((backup) => backup.id === current) ? current : loaded[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load backups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  useEffect(() => {
    if (!activeOperation || activeOperation.status !== 'running') return;

    const intervalId = window.setInterval(async () => {
      try {
        const operation = await getBackupOperation(activeOperation.id);
        setActiveOperation(operation);
        if (operation.status === 'completed') {
          setWorking(false);
          if (operation.backup) {
            const completedBackup = operation.backup;
            setBackups((current) => {
              const exists = current.some((backup) => backup.id === completedBackup.id);
              return exists
                ? current.map((backup) => (backup.id === completedBackup.id ? completedBackup : backup))
                : [completedBackup, ...current];
            });
            setSelectedId(completedBackup.id);
          }
          if (operation.type === 'backup' && operation.backup) {
            setTitle(`Room data backup ${formatBackupDate(new Date().toISOString())}`);
            setDescription('');
            setMessage(`Created backup with ${operation.backup.totalRows.toLocaleString()} row${operation.backup.totalRows === 1 ? '' : 's'}.`);
          }
          if (operation.type === 'restore') {
            setMessage('Restore complete. Refreshing room data now.');
            await refreshRoomData();
          }
        }
        if (operation.status === 'failed') {
          setWorking(false);
          setError(operation.error ?? operation.message ?? 'Backup operation failed.');
        }
      } catch (pollError) {
        setWorking(false);
        setError(pollError instanceof Error ? pollError.message : 'Could not read backup progress.');
      }
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeOperation, refreshRoomData]);

  const createBackup = async () => {
    setWorking(true);
    setActiveOperation(null);
    setMessage('');
    setError('');
    try {
      const operation = await createDataBackup(title, description);
      setActiveOperation(operation);
      setMessage('Backup started.');
    } catch (createError) {
      setWorking(false);
      setError(createError instanceof Error ? createError.message : 'Could not create backup.');
    }
  };

  const restoreBackup = async () => {
    if (!selectedBackup) return;
    const confirmed = window.confirm(`Restore "${selectedBackup.title}" from ${formatBackupDate(selectedBackup.createdAt)}? This replaces the current room data, configuration, imports, and governance records.`);
    if (!confirmed) return;

    setWorking(true);
    setActiveOperation(null);
    setMessage('');
    setError('');
    try {
      const operation = await restoreDataBackup(selectedBackup.id);
      setActiveOperation(operation);
      setMessage('Restore started.');
    } catch (restoreError) {
      setWorking(false);
      setError(restoreError instanceof Error ? restoreError.message : 'Could not restore backup.');
    }
  };

  const deleteBackup = async () => {
    if (!selectedBackup) return;
    const confirmed = window.confirm(`Delete "${selectedBackup.title}"? This removes the backup set and all stored snapshot rows.`);
    if (!confirmed) return;

    setDeletingId(selectedBackup.id);
    setMessage('');
    setError('');
    try {
      const deletedId = await deleteDataBackup(selectedBackup.id);
      setBackups((current) => {
        const next = current.filter((backup) => backup.id !== deletedId);
        setSelectedId(next[0]?.id ?? null);
        return next;
      });
      setMessage('Backup deleted.');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete backup.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Data Backups"
        description="Create dated room data backup sets, inspect row counts, and restore a previous set when a controlled rollback is needed."
        action={<button className="btn-secondary" onClick={loadBackups} disabled={loading || working}><RefreshCcw size={16} /> Refresh</button>}
      />

      {activeOperation && <BackupOperationProgress operation={activeOperation} />}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="panel rounded-lg p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-md bg-ecu-mint p-2 text-ecu-green">
                <Database size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-950">Create backup set</h3>
                <p className="mt-1 text-sm text-slate-600">Snapshots include rooms, campuses, buildings, patterns, dynamic attributes, imports, and governance records.</p>
              </div>
            </div>

            <div className="space-y-4">
              <TextInput label="Backup name" value={title} onChange={setTitle} />
              <label className="block">
                <span className="label">Notes</span>
                <textarea className="input mt-1 min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <button className="btn-primary w-full" disabled={working || !title.trim()} onClick={createBackup}>
                <Archive size={16} /> {working ? 'Working...' : 'Back up current data'}
              </button>
            </div>
          </div>

          <div className="panel rounded-lg overflow-hidden">
            <div className="border-b border-slate-200 p-4">
              <h3 className="font-bold text-slate-950">Backup sets</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {loading && <div className="p-4"><LoadingPanelMessage label="Loading backups" /></div>}
              {!loading && backups.map((backup) => (
                <button
                  key={backup.id}
                  className={cn('block w-full px-4 py-3 text-left transition hover:bg-slate-50', selectedBackup?.id === backup.id && 'bg-ecu-mint')}
                  onClick={() => setSelectedId(backup.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{backup.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{formatBackupDate(backup.createdAt)}</p>
                      {backup.restoredAt && <p className="mt-1 text-xs text-amber-700">Last restored {formatBackupDate(backup.restoredAt)}</p>}
                    </div>
                    <span className="badge border-slate-200 bg-white text-slate-700">{backup.totalRows.toLocaleString()} rows</span>
                  </div>
                </button>
              ))}
              {!loading && !backups.length && <p className="p-4 text-sm text-slate-600">No backups have been created yet.</p>}
            </div>
          </div>
        </div>

        <div className="panel rounded-lg p-5">
          {selectedBackup ? (
            <>
              <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-950">{selectedBackup.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">Created {formatBackupDate(selectedBackup.createdAt)}</p>
                  {selectedBackup.description && <p className="mt-3 text-sm leading-6 text-slate-700">{selectedBackup.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" disabled={working || deletingId === selectedBackup.id} onClick={deleteBackup}>
                    <Trash2 size={16} /> {deletingId === selectedBackup.id ? 'Deleting...' : 'Delete'}
                  </button>
                  <button className="btn-primary" disabled={working || deletingId === selectedBackup.id} onClick={restoreBackup}>
                    <RefreshCcw size={16} /> {working ? 'Working...' : 'Restore this backup'}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <BackupMetric icon={Database} label="Total rows" value={selectedBackup.totalRows.toLocaleString()} detail="Rows captured" />
                <BackupMetric icon={Building2} label="Rooms" value={(selectedBackup.rowCounts.rooms ?? 0).toLocaleString()} detail="Room records" />
                <BackupMetric icon={ListChecks} label="Attributes" value={(selectedBackup.rowCounts.room_attribute_values ?? 0).toLocaleString()} detail="Dynamic values" />
              </div>

              <BackupRowCounts rowCounts={selectedBackup.rowCounts} />
            </>
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
              Choose a backup set to inspect its row counts.
            </div>
          )}

          {message && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </section>
    </>
  );
}

function BackupMetric({ icon: Icon, label, value, detail }: { icon: typeof Home; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="label">{label}</p>
        <Icon size={16} className="text-ecu-green" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </div>
  );
}

function BackupOperationProgress({ operation }: { operation: BackupOperation }) {
  const isFailed = operation.status === 'failed';
  const isComplete = operation.status === 'completed';
  const tableLabel = operation.currentTable ? operation.currentTable.replace(/_/g, ' ') : '';

  return (
    <div className={cn(
      'mb-6 rounded-lg border p-4',
      isFailed && 'border-red-200 bg-red-50 text-red-800',
      isComplete && 'border-emerald-200 bg-emerald-50 text-emerald-800',
      !isFailed && !isComplete && 'border-ecu-teal/30 bg-ecu-mint text-slate-800',
    )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-slate-950">
            {operation.type === 'backup' ? 'Backup progress' : 'Restore progress'}
          </p>
          <p className="mt-1 text-sm">{operation.message}</p>
        </div>
        <span className="badge border-white/70 bg-white text-slate-700">
          {operation.percent}% complete
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div
          className={cn('h-full rounded-full transition-all', isFailed ? 'bg-red-500' : isComplete ? 'bg-emerald-500' : 'bg-ecu-teal')}
          style={{ width: `${Math.max(operation.percent, operation.status === 'running' ? 6 : 0)}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs font-medium text-slate-600">
        <span>{operation.completedTables} of {operation.totalTables} table{operation.totalTables === 1 ? '' : 's'}</span>
        {tableLabel && <span>Current: {tableLabel}</span>}
        {operation.processedRows ? <span>{operation.processedRows.toLocaleString()} rows processed</span> : null}
        {operation.currentTableRows ? <span>{operation.currentTableRows.toLocaleString()} rows in current table</span> : null}
      </div>
    </div>
  );
}

function BackupRowCounts({ rowCounts }: { rowCounts: Record<string, number> }) {
  const rows = Object.entries(rowCounts).sort(([first], [second]) => first.localeCompare(second));

  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2 font-semibold">Data table</th>
            <th className="px-3 py-2 text-right font-semibold">Rows</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([tableName, count]) => (
            <tr key={tableName}>
              <td className="px-3 py-2 font-medium text-slate-800">{tableName.replace(/_/g, ' ')}</td>
              <td className="px-3 py-2 text-right text-slate-700">{count.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBackupDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function Dashboard({
  rooms,
  changeRequests,
  openRoom,
  openSummarySearch,
  roomDataLoading,
}: {
  rooms: Room[];
  changeRequests: ChangeRequest[];
  openRoom: (id: string) => void;
  openSummarySearch: (summaryLabel: string) => void;
  roomDataLoading: boolean;
}) {
  const pendingApprovals = changeRequests.filter((request) => request.status === 'Under Review' || request.status === 'Awaiting Information').length;
  const implementationTasks = changeRequests.flatMap((request) => request.tasks).filter((task) => task.status !== 'Completed' && task.status !== 'Verified');
  const highRisk = changeRequests.filter((request) => request.risk === 'high').length;
  const connectedSystems = new Set(rooms.flatMap((room) => room.downstreamSystems));

  return (
    <>
      <PageHeader
        title="Governed Room Asset Dashboard"
        description="A central view of room data quality, booking posture, workflow risk, and downstream system impact."
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Enterprise room assets"
          value={rooms.length}
          detail={`${rooms.filter((room) => room.isBookable).length} bookable`}
          loading={roomDataLoading}
          loadingLabel="Loading room data"
        />
        <MetricCard icon={ClipboardCheck} label="Pending approvals" value={pendingApprovals} detail={`${highRisk} high-risk changes`} />
        <MetricCard icon={ListChecks} label="Open implementation tasks" value={implementationTasks.length} detail={`${implementationTasks.filter((task) => task.status === 'Blocked').length} blocked`} />
        <MetricCard
          icon={GitBranch}
          label="Connected systems"
          value={connectedSystems.size}
          detail="O365, Archibus, timetable and more"
          loading={roomDataLoading}
          loadingLabel="Loading system data"
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <ChangeRequestList requests={changeRequests} limit={5} />
        <div className="panel rounded-lg">
          <div className="border-b border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Impacted Systems Summary</h3>
          </div>
          <div className="space-y-3 p-4">
            {roomDataLoading ? <LoadingPanelMessage label="Loading impacted systems" /> : (() => {
              const summaryCounts = impactedSystemSummaryRows.map((summaryRow) => ({
                ...summaryRow,
                count: rooms.filter(summaryRow.matches).length,
              }));
              const maxSummaryCount = Math.max(...summaryCounts.map((summaryRow) => summaryRow.count), 1);

              return summaryCounts.map((summaryRow) => {
                const percentage = (summaryRow.count / maxSummaryCount) * 100;
                return (
                  <button
                    key={summaryRow.label}
                    type="button"
                    onClick={() => openSummarySearch(summaryRow.label)}
                    className="block w-full rounded-md p-1 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-ecu-teal focus:ring-offset-2"
                    aria-label={`Show Room Search results for ${summaryRow.label}`}
                  >
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium text-slate-700">{summaryRow.label}</span>
                      <span className="text-slate-500">{summaryRow.count} rooms</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-ecu-teal" style={{ width: `${summaryRow.count ? Math.max(10, percentage) : 0}%` }} />
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <RoomsNeedingAttention rooms={rooms} openRoom={openRoom} loading={roomDataLoading} limit={5} />
        <div className="panel rounded-lg p-4">
          <h3 className="font-bold text-slate-950">Recently Completed Controls</h3>
          <div className="mt-4 space-y-3">
            {['RLS policies defined for role-based access', 'Transformation rule register seeded', 'Import audit model created'].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 size={18} />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  loading = false,
  loadingLabel = 'Loading',
}: {
  icon: typeof Home;
  label: string;
  value: string | number;
  detail: string;
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <div className="panel rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="label">{label}</p>
          {loading ? (
            <div className="mt-3 flex h-9 items-center gap-3" role="status" aria-live="polite">
              <span className="loading-spinner" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-600">{loadingLabel}</span>
            </div>
          ) : (
            <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
          )}
        </div>
        <div className="rounded-md bg-ecu-mint p-2 text-ecu-green">
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600">{loading ? 'Fetching Supabase records...' : detail}</p>
    </div>
  );
}

function LoadingPanelMessage({ label }: { label: string }) {
  return (
    <div className="flex min-h-[140px] items-center justify-center gap-3 p-6 text-sm font-semibold text-slate-600" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

function IssuesDashboard({
  issues,
  businessUnits,
  categories,
  statuses,
  openAllIssues,
  openFilteredIssues,
}: {
  issues: Issue[];
  businessUnits: BusinessUnit[];
  categories: IssueCategory[];
  statuses: IssueStatus[];
  openAllIssues: () => void;
  openFilteredIssues: (filter: IssueListFilter) => void;
}) {
  const openIssues = issues.filter((issue) => issue.status !== 'Closed');
  const categoryCounts = categories.map((category) => ({
    label: category.name,
    count: issues.filter((issue) => issue.category === category.name).length,
    colour: getIssueCategoryChartColour(category.name),
    filter: { category: category.name },
  }));
  const statusCounts = statuses.map((status) => ({
    label: status.name,
    count: issues.filter((issue) => issue.status === status.name).length,
    colour: getIssueStatusChartColour(status.name),
    filter: { status: status.name },
  }));
  const unitCounts = businessUnits.map((unit) => ({
    label: unit.name,
    count: issues.filter((issue) => issue.businessUnitId === unit.id).length,
    colour: unit.colour,
    filter: { unit: unit.id },
  }));
  const priorityCounts = orderIssueChartRows(countBy(issues, (issue) => issue.priority || 'Unspecified'), issuePriorityChartOrder)
    .slice(0, 6)
    .map((row) => ({ ...row, colour: getIssuePriorityChartColour(row.label), filter: { priority: row.label } }));
  const agingItems = openIssues
    .map((issue) => ({ issue, age: issueAgeDays(issue) }))
    .sort((a, b) => b.age - a.age)
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title="Issues Register"
        description={`Imported ${issuesImportSummary.issueCount.toLocaleString()} post occupancy issues from ${issuesImportSummary.businessUnitCount} worksheet tabs. Dashboard metrics use the source tab colours.`}
        action={<button className="btn-primary" onClick={openAllIssues}><ListChecks size={16} /> All Issues</button>}
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={AlertTriangle} label="Total issues" value={issues.length} detail={`${businessUnits.length} business units`} />
        <MetricCard icon={ListChecks} label="Open issues" value={statusCounts.find((item) => item.label === 'Open')?.count ?? 0} detail={`${openIssues.length} active items`} />
        <MetricCard icon={RefreshCcw} label="In-progress" value={statusCounts.find((item) => item.label === 'In-Progress')?.count ?? 0} detail="Currently being actioned" />
        <MetricCard icon={CheckCircle2} label="Ready for inspection" value={statusCounts.find((item) => item.label === 'Ready for User Inspection')?.count ?? 0} detail="Waiting on user review" />
        <MetricCard icon={ClipboardCheck} label="Closed issues" value={statusCounts.find((item) => item.label === 'Closed')?.count ?? 0} detail="Completed or accepted" />
        <MetricCard icon={GitBranch} label="Change requests" value={issues.filter((issue) => issue.isChangeRequest).length} detail="Normalised from category and subject" />
        <MetricCard icon={Wrench} label="Defects" value={issues.filter((issue) => !issue.isChangeRequest).length} detail="Grouped by category" />
        <MetricCard icon={History} label="Aging open items" value={agingItems.filter((item) => item.age >= 30).length} detail="Open for 30+ days" />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <IssueBarChart title="Issues by Business Unit" rows={unitCounts} onSelect={(row) => row.filter && openFilteredIssues(row.filter)} />
        <IssueDonutChart title="Issues by Status" rows={orderIssueChartRows(statusCounts, issueStatusChartOrder)} onSelect={(row) => row.filter && openFilteredIssues(row.filter)} />
        <IssueBarChart title="Issues by Category" rows={orderIssueChartRows(categoryCounts, issueCategoryChartOrder)} onSelect={(row) => row.filter && openFilteredIssues(row.filter)} />
        <IssueDonutChart title="Issues by Priority" rows={priorityCounts} onSelect={(row) => row.filter && openFilteredIssues(row.filter)} />
      </section>

      <section className="mt-6">
        <div className="panel rounded-lg p-4">
          <h3 className="font-bold text-slate-950">Oldest open items</h3>
          <div className="mt-3 divide-y divide-slate-200">
            {agingItems.map(({ issue, age }) => (
              <div key={issue.id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-slate-950">{issue.issueId}</span>
                  <span className="badge border-amber-200 bg-amber-50 text-amber-700">{age} days</span>
                </div>
                <p className="mt-1 text-slate-700">{issue.subject || issue.detail || 'No subject recorded'}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

type IssueRegisterMode = 'all' | 'change-requests' | 'defects';
type IssueSortKey = 'businessUnitName' | 'issueId' | 'dateIdentified' | 'contactPerson' | 'roomCode' | 'roomName' | 'subject' | 'priority' | 'category' | 'responsiblePerson' | 'status' | 'isChangeRequest';

function IssuesRegisterPage({
  mode,
  issues,
  setIssues,
  businessUnits,
  categories,
  statuses,
  attachments,
  rooms,
  openRoomProfile,
  requireAuthenticatedEdit,
  initialFilter,
}: {
  mode: IssueRegisterMode;
  issues: Issue[];
  setIssues: (issues: Issue[]) => void;
  businessUnits: BusinessUnit[];
  categories: IssueCategory[];
  statuses: IssueStatus[];
  attachments: IssueAttachmentReference[];
  rooms: Room[];
  openRoomProfile: (roomCode: string) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
  initialFilter: IssueListFilter;
}) {
  const [query, setQuery] = useState('');
  const [unit, setUnit] = useState('All');
  const [priority, setPriority] = useState('All');
  const [status, setStatus] = useState('All');
  const [category, setCategory] = useState('All');
  const [responsible, setResponsible] = useState('All');
  const [quickFilter, setQuickFilter] = useState('All');
  const [sortKey, setSortKey] = useState<IssueSortKey>('dateIdentified');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const pageSize = 25;
  const deferredQuery = useDeferredValue(query);
  const visibleModeIssues = mode === 'change-requests'
    ? issues.filter((issue) => issue.isChangeRequest)
    : mode === 'defects'
      ? issues.filter((issue) => !issue.isChangeRequest)
      : issues;

  const priorityOptions = useMemo(() => {
    const options = Array.from(new Set(issues.map((issue) => issue.priority).filter(Boolean))).sort();
    if (issues.some((issue) => !issue.priority)) options.push('Unspecified');
    return ['All', ...options];
  }, [issues]);
  const responsibleOptions = useMemo(() => ['All', ...Array.from(new Set(issues.map((issue) => issue.responsiblePerson).filter(Boolean))).sort()], [issues]);

  useEffect(() => {
    setQuery(initialFilter.query ?? '');
    setUnit(initialFilter.unit ?? 'All');
    setPriority(initialFilter.priority ?? 'All');
    setStatus(initialFilter.status ?? 'All');
    setCategory(initialFilter.category ?? 'All');
    setResponsible(initialFilter.responsible ?? 'All');
    setQuickFilter(initialFilter.quickFilter ?? 'All');
  }, [initialFilter]);

  const filteredIssues = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    return visibleModeIssues
      .filter((issue) => unit === 'All' || issue.businessUnitId === unit)
      .filter((issue) => priority === 'All' || (priority === 'Unspecified' ? !issue.priority : issue.priority === priority))
      .filter((issue) => status === 'All' || issue.status === status)
      .filter((issue) => category === 'All' || issue.category === category)
      .filter((issue) => responsible === 'All' || issue.responsiblePerson === responsible)
      .filter((issue) => matchesIssueQuickFilter(issue, quickFilter))
      .filter((issue) => {
        if (!search) return true;
        return [
          issue.issueId,
          issue.businessUnitName,
          issue.contactPerson,
          issue.roomCode,
          issue.roomName,
          issue.subject,
          issue.detail,
          issue.priority,
          issue.category,
          issue.responsiblePerson,
          issue.status,
          issue.sourceCategory,
          ...Object.values(issue.metadata),
        ].join(' ').toLowerCase().includes(search);
      })
      .sort((a, b) => compareIssueField(a, b, sortKey, sortDirection));
  }, [category, deferredQuery, priority, quickFilter, responsible, sortDirection, sortKey, status, unit, visibleModeIssues]);

  useEffect(() => {
    setPage(1);
  }, [category, deferredQuery, priority, quickFilter, responsible, status, unit, mode]);

  const pageCount = Math.max(1, Math.ceil(filteredIssues.length / pageSize));
  const pagedIssues = filteredIssues.slice((page - 1) * pageSize, page * pageSize);
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) ?? null;

  const [showNewIssue, setShowNewIssue] = useState(false);

  const updateIssue = (nextIssue: Issue) => {
    setIssues(issues.map((issue) => (issue.id === nextIssue.id ? nextIssue : issue)));
  };

  const addIssue = (newIssue: Issue) => {
    setIssues([newIssue, ...issues]);
    setShowNewIssue(false);
    setSelectedIssueId(newIssue.id);
  };

  const title = mode === 'change-requests' ? 'Change Requests' : mode === 'defects' ? 'Defects' : 'All Issues';
  const activeFilterLabels = [
    unit !== 'All' ? `Business unit: ${businessUnits.find((item) => item.id === unit)?.name ?? unit}` : '',
    priority !== 'All' ? `Priority: ${priority}` : '',
    status !== 'All' ? `Status: ${status}` : '',
    category !== 'All' ? `Category: ${category}` : '',
    responsible !== 'All' ? `Responsible: ${responsible}` : '',
    quickFilter !== 'All' ? quickFilter : '',
    query ? `Search: ${query}` : '',
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title={title}
        description="Search, sort, triage, export, comment, and update imported post occupancy issues."
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => exportIssuesCsv(filteredIssues)}><Download size={16} /> Export CSV</button>
            <button className="btn-primary" onClick={() => setShowNewIssue(true)}><Plus size={16} /> New Issue</button>
          </div>
        }
      />
      {activeFilterLabels.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ecu-teal/30 bg-ecu-mint px-3 py-2 text-sm text-ecu-black">
          <span className="font-semibold">Dashboard filter</span>
          {activeFilterLabels.map((label) => <span key={label} className="badge border-ecu-teal/30 bg-white text-slate-700">{label}</span>)}
        </div>
      )}
      <div className="panel rounded-lg p-4">
        <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <label className="relative block">
            <span className="label">Global search</span>
            <Search className="absolute left-3 top-[34px] text-slate-400" size={18} />
            <input className="input mt-1 pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Issue, room, subject, contact, responsible..." />
          </label>
          <div>
            <label className="label">Business unit</label>
            <select className="input mt-1" value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="All">All</option>
              {businessUnits.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <FilterSelect label="Priority" value={priority} setValue={setPriority} options={priorityOptions} />
          <FilterSelect label="Status" value={status} setValue={setStatus} options={['All', ...statuses.map((item) => item.name)]} />
          <FilterSelect label="Category" value={category} setValue={setCategory} options={['All', ...categories.map((item) => item.name)]} />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <FilterSelect label="Responsible" value={responsible} setValue={setResponsible} options={responsibleOptions} />
          <div>
            <label className="label">Quick filters</label>
            <div className="mt-1 flex flex-wrap gap-2">
              {issueQuickFilters.map((filter) => (
                <button
                  key={filter}
                  className={cn('badge transition', quickFilter === filter ? 'border-ecu-teal bg-ecu-mint text-ecu-black' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
                  onClick={() => setQuickFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 panel overflow-hidden rounded-lg">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>Showing {pagedIssues.length.toLocaleString()} of {filteredIssues.length.toLocaleString()} issue{filteredIssues.length === 1 ? '' : 's'}</p>
          <div className="flex items-center gap-2">
            <button className="btn-secondary py-1" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span className="font-semibold text-slate-700">Page {page} of {pageCount}</span>
            <button className="btn-secondary py-1" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {issueColumns.map((column) => (
                  <th key={column.key} className="px-3 py-3">
                    <button className="inline-flex items-center gap-1 font-bold" onClick={() => {
                      if (sortKey === column.key) setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                      else {
                        setSortKey(column.key);
                        setSortDirection('asc');
                      }
                    }}>
                      {column.label}
                      <ChevronDown size={14} className={cn(sortKey === column.key && sortDirection === 'asc' && 'rotate-180')} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pagedIssues.map((issue) => {
                const roomExists = Boolean(issue.roomCode && rooms.some((room) => normalizeRoomCodeKey(room.roomCode) === normalizeRoomCodeKey(issue.roomCode)));
                return (
                  <tr key={issue.id} className="align-top hover:bg-slate-50">
                    <td className="px-3 py-3">
                      <BusinessUnitBadge name={issue.businessUnitName} colour={issue.businessUnitColour} />
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-950">
                      <button className="text-left hover:text-ecu-teal" onClick={() => setSelectedIssueId(issue.id)}>{issue.issueId}</button>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{formatIssueDate(issue.dateIdentified)}</td>
                    <td className="px-3 py-3 text-slate-700">{issue.contactPerson || '-'}</td>
                    <td className="px-3 py-3">
                      {issue.roomCode ? (
                        <button
                          className="font-bold text-ecu-teal hover:underline"
                          onClick={() => setSelectedIssueId(issue.id)}
                        >
                          {issue.roomCode}
                        </button>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-3 text-slate-700">{issue.roomName || '-'}</td>
                    <td className="max-w-[320px] px-3 py-3">
                      <button className="text-left font-semibold text-slate-950 hover:text-ecu-teal" onClick={() => setSelectedIssueId(issue.id)}>
                        {issue.subject || issue.detail || 'No subject'}
                      </button>
                    </td>
                    <td className="px-3 py-3"><PriorityBadge priority={issue.priority} /></td>
                    <td className="px-3 py-3"><IssueCategoryBadge category={issue.category} /></td>
                    <td className="px-3 py-3 text-slate-700">{issue.responsiblePerson || '-'}</td>
                    <td className="px-3 py-3"><StatusBadge status={issue.status} /></td>
                    <td className="px-3 py-3">{issue.isChangeRequest ? <span className="badge border-purple-200 bg-purple-50 text-purple-700">Yes</span> : <span className="badge border-slate-200 bg-slate-50 text-slate-600">No</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showNewIssue && (
        <NewIssueModal
          issues={issues}
          businessUnits={businessUnits}
          categories={categories}
          statuses={statuses}
          addIssue={addIssue}
          close={() => setShowNewIssue(false)}
          requireAuthenticatedEdit={requireAuthenticatedEdit}
        />
      )}
      {selectedIssue && !showNewIssue && (() => {
        const linkedRoom = selectedIssue.roomCode ? rooms.find((room) => normalizeRoomCodeKey(room.roomCode) === normalizeRoomCodeKey(selectedIssue.roomCode)) : undefined;
        return (
          <IssueDetailModal
            issue={selectedIssue}
            categories={categories}
            statuses={statuses}
            attachments={attachments.filter((attachment) => attachment.issueId === selectedIssue.id)}
            roomExists={Boolean(linkedRoom)}
            roomFloorplanImageUrl={linkedRoom?.floorplanImageUrl}
            openRoomProfile={openRoomProfile}
            updateIssue={updateIssue}
            close={() => setSelectedIssueId(null)}
            requireAuthenticatedEdit={requireAuthenticatedEdit}
          />
        );
      })()}
    </>
  );
}

function IssueReports({ issues, businessUnits, categories, statuses }: { issues: Issue[]; businessUnits: BusinessUnit[]; categories: IssueCategory[]; statuses: IssueStatus[] }) {
  const activeIssues = issues.filter((issue) => issue.status !== 'Closed');
  const exportDashboardPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('ECU Issues Register Dashboard Summary', 14, 18);
    doc.setFontSize(10);
    [
      `Total issues: ${issues.length}`,
      `Open issues: ${issues.filter((issue) => issue.status === 'Open').length}`,
      `In-progress issues: ${issues.filter((issue) => issue.status === 'In-Progress').length}`,
      `Ready for user inspection: ${issues.filter((issue) => issue.status === 'Ready for User Inspection').length}`,
      `Closed issues: ${issues.filter((issue) => issue.status === 'Closed').length}`,
      `Change requests: ${issues.filter((issue) => issue.isChangeRequest).length}`,
    ].forEach((line, index) => doc.text(line, 14, 32 + index * 8));
    doc.text('Issues by business unit', 14, 92);
    businessUnits.slice(0, 20).forEach((unit, index) => doc.text(`${unit.name}: ${issues.filter((issue) => issue.businessUnitId === unit.id).length}`, 14, 104 + index * 6));
    doc.save('issues-dashboard-summary.pdf');
  };
  const exportActiveIssuePdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Active Issue Detail Report', 14, 18);
    doc.setFontSize(9);
    let y = 30;
    activeIssues.slice(0, 45).forEach((issue) => {
      doc.text(`${issue.issueId} | ${issue.status} | ${issue.category}`, 14, y);
      y += 5;
      doc.text(doc.splitTextToSize(`${issue.businessUnitName} | ${issue.roomCode || 'No room'} | ${issue.subject || issue.detail}`, 180), 14, y);
      y += 12;
      if (y > 275) {
        doc.addPage();
        y = 18;
      }
    });
    doc.save('active-issue-detail-report.pdf');
  };

  return (
    <>
      <PageHeader title="Issue Reports" description="Export dashboard summaries, filtered data, and active issue detail packs." />
      <section className="grid gap-5 lg:grid-cols-3">
        <ReportCard title="Filtered CSV" detail="Exports the complete issue register dataset for offline sorting and reporting." action={<button className="btn-primary" onClick={() => exportIssuesCsv(issues)}><Download size={16} /> Export CSV</button>} />
        <ReportCard title="Dashboard PDF" detail="Creates a PDF summary of headline metrics and business unit counts." action={<button className="btn-primary" onClick={exportDashboardPdf}><FileText size={16} /> Export PDF</button>} />
        <ReportCard title="Issue detail PDF" detail="Creates a PDF pack for active open, in-progress, and inspection items." action={<button className="btn-primary" onClick={exportActiveIssuePdf}><FileText size={16} /> Export PDF</button>} />
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <IssueBarChart title="Report categories" rows={categories.map((category) => ({ label: category.name, count: issues.filter((issue) => issue.category === category.name).length }))} />
        <IssueBarChart title="Report statuses" rows={statuses.map((status) => ({ label: status.name, count: issues.filter((issue) => issue.status === status.name).length }))} />
      </section>
    </>
  );
}

function IssueAdmin({
  businessUnits,
  setBusinessUnits,
  categories,
  setCategories,
  statuses,
  setStatuses,
  issues,
  setIssues,
  requireAuthenticatedEdit,
}: {
  businessUnits: BusinessUnit[];
  setBusinessUnits: (units: BusinessUnit[]) => void;
  categories: IssueCategory[];
  setCategories: (categories: IssueCategory[]) => void;
  statuses: IssueStatus[];
  setStatuses: (statuses: IssueStatus[]) => void;
  issues: Issue[];
  setIssues: (issues: Issue[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const commenterNames = Array.from(new Set(issues.flatMap((issue) => issue.comments.map((comment) => comment.author)).filter(Boolean))).sort();
  const [colourSaveError, setColourSaveError] = useState('');
  const colourSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateUnitColour = (unitId: string, colour: string) => {
    if (!requireAuthenticatedEdit('manage business unit colours')) return;
    const unit = businessUnits.find((u) => u.id === unitId);
    setBusinessUnits(businessUnits.map((u) => (u.id === unitId ? { ...u, colour } : u)));
    setIssues(issues.map((issue) => (issue.businessUnitId === unitId ? { ...issue, businessUnitColour: colour } : issue)));
    if (!supabase || !unit) return;
    const supabaseClient = supabase;
    if (colourSaveTimerRef.current) clearTimeout(colourSaveTimerRef.current);
    colourSaveTimerRef.current = setTimeout(async () => {
      const { error } = await supabaseClient.from('business_units').upsert({ name: unit.name, reference_colour: colour }, { onConflict: 'name' });
      if (error) setColourSaveError(`Could not save colour for ${unit.name}: ${error.message}`);
      else setColourSaveError('');
    }, 400);
  };
  const addCategory = () => {
    if (!requireAuthenticatedEdit('manage issue categories')) return;
    const name = window.prompt('New category name');
    if (!name) return;
    setCategories([...categories, { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sortOrder: categories.length }]);
  };
  const addStatus = () => {
    if (!requireAuthenticatedEdit('manage issue statuses')) return;
    const name = window.prompt('New status name');
    if (!name) return;
    setStatuses([...statuses, { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sortOrder: statuses.length }]);
  };

  return (
    <>
      <PageHeader title="Issue Admin" description="Manage normalised categories, status options, business unit colours, and commenter names." />
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="panel rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-950">Categories</h3>
            <button className="btn-secondary py-1" onClick={addCategory}><Plus size={15} /> Add</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((category) => <IssueCategoryBadge key={category.id} category={category.name} />)}
          </div>
        </div>
        <div className="panel rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-slate-950">Statuses</h3>
            <button className="btn-secondary py-1" onClick={addStatus}><Plus size={15} /> Add</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {statuses.map((status) => <StatusBadge key={status.id} status={status.name} />)}
          </div>
        </div>
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.7fr]">
        <div className="panel rounded-lg p-4">
          <h3 className="font-bold text-slate-950">Business unit colours</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {businessUnits.map((unit) => (
              <label key={unit.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3">
                <BusinessUnitBadge name={unit.name} colour={unit.colour} />
                <input type="color" value={unit.colour} onChange={(event) => updateUnitColour(unit.id, event.target.value)} aria-label={`Colour for ${unit.name}`} />
              </label>
            ))}
          </div>
          {colourSaveError && <p className="mt-2 text-sm text-red-600">{colourSaveError}</p>}
        </div>
        <div className="panel rounded-lg p-4">
          <h3 className="font-bold text-slate-950">Commenter names</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {commenterNames.map((name) => <span key={name} className="badge border-slate-200 bg-slate-50 text-slate-700">{name}</span>)}
            {!commenterNames.length && <p className="text-sm text-slate-600">No comments recorded yet.</p>}
          </div>
        </div>
      </section>
    </>
  );
}

const issuePriorities = [
  '1 - Immediate (Critical Emergency)',
  '2 - Urgent - Significant Impact',
  '3 - Standard - Moderate Impact',
  '4 - Minor - Low Impact / Cosmetic',
];

function nextIssueIdForUnit(issues: Issue[], businessUnitId: string, businessUnitName: string): string {
  const prefix = businessUnitName.replace(/\s/g, '_').replace(/[^A-Za-z0-9_+]/g, '');
  const nums = issues
    .filter((i) => i.businessUnitId === businessUnitId)
    .map((i) => { const m = i.issueId.match(/(\d+)$/); return m ? parseInt(m[1], 10) : 0; });
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function NewIssueModal({
  issues,
  businessUnits,
  categories,
  statuses,
  addIssue,
  close,
  requireAuthenticatedEdit,
}: {
  issues: Issue[];
  businessUnits: BusinessUnit[];
  categories: IssueCategory[];
  statuses: IssueStatus[];
  addIssue: (issue: Issue) => void;
  close: () => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultUnit = businessUnits[0];
  const defaultStatus = statuses.find((s) => s.name === 'Open') ?? statuses[0];
  const defaultCategory = categories[0];

  const [unitId, setUnitId] = useState(defaultUnit?.id ?? '');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [categoryName, setCategoryName] = useState(defaultCategory?.name ?? '');
  const [statusName, setStatusName] = useState(defaultStatus?.name ?? 'Open');
  const [priority, setPriority] = useState('');
  const [dateIdentified, setDateIdentified] = useState(today);
  const [contactPerson, setContactPerson] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const [responsiblePerson, setResponsiblePerson] = useState('');
  const [isChangeRequest, setIsChangeRequest] = useState(false);
  const [error, setError] = useState('');

  const selectedUnit = businessUnits.find((u) => u.id === unitId);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!requireAuthenticatedEdit('add a new issue')) return;
    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!selectedUnit) { setError('Business unit is required.'); return; }
    setError('');
    const issueId = nextIssueIdForUnit(issues, unitId, selectedUnit.name);
    const id = `${unitId}-${Date.now()}`;
    const newIssue: Issue = {
      id,
      issueId,
      businessUnitId: unitId,
      businessUnitName: selectedUnit.name,
      businessUnitColour: selectedUnit.colour,
      originalWorksheet: selectedUnit.name,
      originalRowNumber: 0,
      dateIdentified,
      contactPerson: contactPerson.trim(),
      roomCode: roomCode.trim(),
      roomName: roomName.trim(),
      subject: subject.trim(),
      detail: detail.trim(),
      priority,
      photoReference: '',
      sourceCategory: categoryName,
      category: categoryName,
      isChangeRequest: isChangeRequest || categoryName === 'Change Request',
      responsiblePerson: responsiblePerson.trim(),
      status: statusName as Issue['status'],
      dateClosed: '',
      aconexRef: '',
      aconexFieldDefect: '',
      metadata: {},
      comments: [],
    };
    addIssue(newIssue);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <div className="ml-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-panel">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 p-5">
          <h2 className="text-xl font-bold text-slate-950">New Issue</h2>
          <button className="btn-secondary" onClick={close}>Cancel</button>
        </div>
        <form className="min-h-0 flex-1 overflow-y-auto p-5" onSubmit={handleSubmit}>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Business unit <span className="text-red-500">*</span></span>
                <select className="input mt-1" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                  {businessUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Date identified</span>
                <input type="date" className="input mt-1" value={dateIdentified} onChange={(e) => setDateIdentified(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="label">Subject <span className="text-red-500">*</span></span>
              <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief description of the issue" />
            </label>
            <label className="block">
              <span className="label">Detail</span>
              <textarea className="input mt-1 min-h-[96px]" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Full detail..." />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Category <span className="text-red-500">*</span></span>
                <select className="input mt-1" value={categoryName} onChange={(e) => { setCategoryName(e.target.value); if (e.target.value === 'Change Request') setIsChangeRequest(true); }}>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Status</span>
                <select className="input mt-1" value={statusName} onChange={(e) => setStatusName(e.target.value)}>
                  {statuses.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Priority</span>
                <select className="input mt-1" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">— Unspecified —</option>
                  {issuePriorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Responsible person</span>
                <input className="input mt-1" value={responsiblePerson} onChange={(e) => setResponsiblePerson(e.target.value)} placeholder="Name" />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">Contact person</span>
                <input className="input mt-1" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Name" />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Room code</span>
                  <input className="input mt-1" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="e.g. 1N.448" />
                </label>
                <label className="block">
                  <span className="label">Room name</span>
                  <input className="input mt-1" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name" />
                </label>
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isChangeRequest} onChange={(e) => setIsChangeRequest(e.target.checked)} />
              <span className="label mb-0">Change request</span>
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary">Create Issue</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IssueDetailModal({
  issue,
  categories,
  statuses,
  attachments,
  roomExists,
  roomFloorplanImageUrl,
  openRoomProfile,
  updateIssue,
  close,
  requireAuthenticatedEdit,
}: {
  issue: Issue;
  categories: IssueCategory[];
  statuses: IssueStatus[];
  attachments: IssueAttachmentReference[];
  roomExists: boolean;
  roomFloorplanImageUrl?: string;
  openRoomProfile: (roomCode: string) => void;
  updateIssue: (issue: Issue) => void;
  close: () => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const [commentText, setCommentText] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('Current user');
  const setCategory = (category: string) => {
    if (!requireAuthenticatedEdit('edit issue category')) return;
    updateIssue({ ...issue, category, isChangeRequest: category === 'Change Request' ? true : issue.isChangeRequest });
  };
  const setStatus = (status: string) => {
    if (!requireAuthenticatedEdit('edit issue status')) return;
    updateIssue({ ...issue, status });
  };
  const setChangeRequest = (isChangeRequest: boolean) => {
    if (!requireAuthenticatedEdit('mark issue change request flag')) return;
    updateIssue({ ...issue, isChangeRequest, category: isChangeRequest ? 'Change Request' : issue.category });
  };
  const addComment = () => {
    if (!commentText.trim()) return;
    if (!requireAuthenticatedEdit('add issue comments')) return;
    const comment: IssueComment = {
      id: `${issue.id}-comment-${Date.now()}`,
      issueId: issue.id,
      text: commentText.trim(),
      author: commentAuthor.trim() || 'Current user',
      createdAt: new Date().toISOString(),
      statusAtTime: issue.status,
    };
    updateIssue({ ...issue, comments: [comment, ...issue.comments] });
    setCommentText('');
  };
  const exportDetailPdf = () => exportIssueDetailPdf(issue, attachments);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 p-4" role="dialog" aria-modal="true">
      <div className="ml-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-panel">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <BusinessUnitBadge name={issue.businessUnitName} colour={issue.businessUnitColour} />
              <StatusBadge status={issue.status} />
              <IssueCategoryBadge category={issue.category} />
              {issue.isChangeRequest && <span className="badge border-purple-200 bg-purple-50 text-purple-700">Change Request</span>}
            </div>
            <h2 className="mt-3 text-xl font-bold text-slate-950">{issue.issueId}: {issue.subject || 'No subject recorded'}</h2>
            <p className="mt-1 text-sm text-slate-600">Source: {issue.originalWorksheet}, row {issue.originalRowNumber}</p>
          </div>
          <button className="btn-secondary" onClick={close}>Close</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <div className="rounded-md border border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">Issue detail</h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">{issue.detail || 'No detail recorded.'}</p>
              </div>
              <IssueFieldGrid issue={issue} />
              <div className="rounded-md border border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">Comments timeline</h3>
                <div className="mt-4 grid gap-3">
                  <input className="input" value={commentAuthor} onChange={(event) => setCommentAuthor(event.target.value)} placeholder="Author" />
                  <textarea className="input min-h-[96px]" value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a comment..." />
                  <button className="btn-primary justify-self-start" onClick={addComment}><MessageSquare size={16} /> Add comment</button>
                </div>
                <div className="mt-5 space-y-3">
                  {issue.comments.map((comment) => (
                    <div key={comment.id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-slate-950">{comment.author}</span>
                        <span className="text-slate-500">{formatIssueDateTime(comment.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-slate-700">{comment.text}</p>
                      <p className="mt-2 text-xs font-semibold text-slate-500">Status at comment: {comment.statusAtTime}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <aside className="space-y-4">
              <div className="rounded-md border border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">Triage</h3>
                <div className="mt-3 space-y-3">
                  <FilterSelect label="Category" value={issue.category} setValue={setCategory} options={categories.map((item) => item.name)} />
                  <FilterSelect label="Status" value={issue.status} setValue={setStatus} options={statuses.map((item) => item.name)} />
                  <Toggle label="Change request" checked={issue.isChangeRequest} onChange={setChangeRequest} />
                </div>
              </div>
              <div className="rounded-md border border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">Room link</h3>
                {roomFloorplanImageUrl && (
                  <div className="mt-3">
                    <RoomFloorplanThumbnail imageUrl={roomFloorplanImageUrl} roomName={issue.roomName || issue.roomCode} isDataLoading={false} />
                  </div>
                )}
                <p className="mt-2 text-sm text-slate-700">{issue.roomCode || 'No room code recorded'}</p>
                {issue.roomCode && (
                  <button className="btn-secondary mt-3" onClick={() => (roomExists ? openRoomProfile(issue.roomCode) : undefined)} disabled={!roomExists}>
                    <ExternalLink size={16} /> Open room details
                  </button>
                )}
              </div>
              <div className="rounded-md border border-slate-200 p-4">
                <h3 className="font-bold text-slate-950">Photo/reference</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {attachments.length ? attachments.map((attachment) => (
                    <div key={attachment.id} className="rounded-md bg-slate-50 p-3">
                      <p className="font-semibold text-slate-800">{attachment.label}</p>
                      {attachment.url && isIssueImageUrl(attachment.url) && (
                        <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-md border border-slate-200 bg-white">
                          <img src={attachment.url} alt={attachment.label} className="max-h-48 w-full object-contain" loading="lazy" />
                        </a>
                      )}
                      {attachment.url && (
                        <a href={attachment.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-slate-600 hover:text-ecu-teal">
                          {isIssueImageUrl(attachment.url) ? 'Open saved image' : attachment.url}
                        </a>
                      )}
                      {attachment.sourceUrl && (
                        <a href={attachment.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-slate-500 hover:text-ecu-teal">
                          Source link
                        </a>
                      )}
                    </div>
                  )) : <p className="text-slate-600">{issue.photoReference || 'No reference recorded.'}</p>}
                </div>
              </div>
              <button className="btn-primary w-full" onClick={exportDetailPdf}><FileText size={16} /> Export detail PDF</button>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

const issueQuickFilters = ['All', 'Priority', 'Status', 'Change Requests', 'AV/IT defects', 'Operations defects', 'FFE defects', 'Building defects', 'Items ready for user inspection'];

const issueColumns: { key: IssueSortKey; label: string }[] = [
  { key: 'businessUnitName', label: 'Business unit' },
  { key: 'issueId', label: 'Issue ID' },
  { key: 'dateIdentified', label: 'Date identified' },
  { key: 'contactPerson', label: 'Contact' },
  { key: 'roomCode', label: 'Room number' },
  { key: 'roomName', label: 'Room name' },
  { key: 'subject', label: 'Subject' },
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'Category' },
  { key: 'responsiblePerson', label: 'Responsible' },
  { key: 'status', label: 'Status' },
  { key: 'isChangeRequest', label: 'CR' },
];

function matchesIssueQuickFilter(issue: Issue, filter: string) {
  if (filter === 'All') return true;
  if (filter === 'Priority') return Boolean(issue.priority);
  if (filter === 'Status') return Boolean(issue.status);
  if (filter === 'Change Requests') return issue.isChangeRequest;
  if (filter === 'AV/IT defects') return !issue.isChangeRequest && issue.category === 'AV/IT';
  if (filter === 'Operations defects') return !issue.isChangeRequest && issue.category === 'Operations';
  if (filter === 'FFE defects') return !issue.isChangeRequest && issue.category === 'FFE';
  if (filter === 'Building defects') return !issue.isChangeRequest && issue.category === 'Building Defect';
  if (filter === 'Items ready for user inspection') return issue.status === 'Ready for User Inspection';
  return true;
}

function isIssueImageUrl(value: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(?:$|[?#])/i.test(value) || value.startsWith('/issue-assets/');
}

function compareIssueField(a: Issue, b: Issue, key: IssueSortKey, direction: 'asc' | 'desc') {
  const modifier = direction === 'asc' ? 1 : -1;
  const aValue = key === 'isChangeRequest' ? Number(a[key]) : String(a[key] ?? '').toLowerCase();
  const bValue = key === 'isChangeRequest' ? Number(b[key]) : String(b[key] ?? '').toLowerCase();
  return aValue > bValue ? modifier : aValue < bValue ? -modifier : 0;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function issueAgeDays(issue: Issue) {
  const value = issue.dateIdentified;
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function formatIssueDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatIssueDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function BusinessUnitBadge({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="badge border-slate-200 bg-white text-slate-800" style={{ borderColor: colour, boxShadow: `inset 4px 0 0 ${colour}` }}>
      {name}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const text = priority || 'Unprioritised';
  const tone = text.startsWith('1') ? 'border-red-200 bg-red-50 text-red-700'
    : text.startsWith('2') ? 'border-orange-200 bg-orange-50 text-orange-700'
      : text.startsWith('3') ? 'border-amber-200 bg-amber-50 text-amber-700'
        : text.startsWith('4') ? 'border-slate-200 bg-slate-50 text-slate-700'
          : 'border-slate-200 bg-white text-slate-600';
  return <span className={cn('badge', tone)}>{text}</span>;
}

function IssueCategoryBadge({ category }: { category: string }) {
  const tone = category === 'Change Request' ? 'border-purple-200 bg-purple-50 text-purple-700'
    : category === 'AV/IT' ? 'border-blue-200 bg-blue-50 text-blue-700'
      : category === 'Operations' ? 'border-teal-200 bg-teal-50 text-teal-700'
        : category === 'FFE' ? 'border-pink-200 bg-pink-50 text-pink-700'
          : category === 'Building Defect' ? 'border-orange-200 bg-orange-50 text-orange-700'
            : 'border-slate-200 bg-slate-50 text-slate-700';
  return <span className={cn('badge', tone)}>{category || 'Other'}</span>;
}

type IssueChartRow = { label: string; count: number; colour?: string; filter?: IssueListFilter };

const issueStatusChartOrder = ['Closed', 'In-Progress', 'Open', 'Ready for User Inspection'];
const issueCategoryChartOrder = ['Building Defect', 'AV/IT', 'Change Request', 'FFE', 'Operations', 'Other'];
const issuePriorityChartOrder = [
  '3 - Standard - Moderate Impact',
  '2 - Urgent - Significant Impact',
  '4 - Minor - Low Impact / Cosmetic',
  'Unspecified',
  '1 - Immediate (Critical Emergency)',
];

const issueStatusChartColours: Record<string, string> = {
  Closed: '#e5252a',
  'In-Progress': '#df7c00',
  Open: '#2f63e6',
  'Ready for User Inspection': '#177a3f',
};

const issueCategoryChartColours: Record<string, string> = {
  'Building Defect': '#2f63e6',
  'AV/IT': '#168277',
  'Change Request': '#ad6c06',
  FFE: '#c81e22',
  Operations: '#7c3aed',
  Other: '#6b7b92',
};

const issuePriorityChartColours: Record<string, string> = {
  '3 - Standard - Moderate Impact': '#a7191d',
  '2 - Urgent - Significant Impact': '#ff7018',
  '4 - Minor - Low Impact / Cosmetic': '#f2b705',
  Unspecified: '#26c45d',
  '1 - Immediate (Critical Emergency)': '#97a7ba',
};

function getIssueStatusChartColour(label: string) {
  return issueStatusChartColours[label] ?? '#6b7b92';
}

function getIssueCategoryChartColour(label: string) {
  return issueCategoryChartColours[label] ?? '#6b7b92';
}

function getIssuePriorityChartColour(label: string) {
  return issuePriorityChartColours[label] ?? '#6b7b92';
}



function orderIssueChartRows(rows: IssueChartRow[], order: string[]) {
  const orderIndex = new Map(order.map((label, index) => [label, index]));
  return [...rows].sort((a, b) => {
    const aIndex = orderIndex.get(a.label);
    const bIndex = orderIndex.get(b.label);
    if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
    if (aIndex !== undefined) return -1;
    if (bIndex !== undefined) return 1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });
}

function niceChartMaximum(value: number) {
  if (value <= 0) return 1;
  const targetTickCount = 5;
  const rawStep = value / targetTickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 7 ? 5 : 10;
  return Math.ceil(value / (niceStep * magnitude)) * niceStep * magnitude;
}

function IssueBarChart({ title, rows, onSelect }: { title: string; rows: IssueChartRow[]; onSelect?: (row: IssueChartRow) => void }) {
  const visibleRows = rows.filter((row) => row.count > 0);
  const max = niceChartMaximum(Math.max(...visibleRows.map((row) => row.count), 1));
  const chartWidth = 760;
  const chartHeight = 360;
  const margin = { top: 20, right: 16, bottom: 76, left: 48 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const gap = visibleRows.length > 8 ? 10 : 26;
  const barWidth = visibleRows.length ? Math.max(14, Math.min(84, (plotWidth - gap * (visibleRows.length - 1)) / visibleRows.length)) : 0;
  const ticks = Array.from({ length: 6 }, (_, index) => Math.round((max / 5) * index));

  return (
    <div className="panel rounded-lg p-4">
      <ChartTitle title={title} />
      <div className="mt-4 h-[360px]">
        <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={title} preserveAspectRatio="none">
          {ticks.map((tick) => {
            const y = margin.top + plotHeight - (tick / max) * plotHeight;
            return (
              <g key={tick}>
                <line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} stroke="#d6dbe1" strokeWidth="1" />
                <text x={margin.left - 10} y={y + 4} textAnchor="end" fill="#555f6d" fontSize="12">{tick.toLocaleString()}</text>
              </g>
            );
          })}
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={margin.top + plotHeight} stroke="#c8ced6" />
          <line x1={margin.left} x2={chartWidth - margin.right} y1={margin.top + plotHeight} y2={margin.top + plotHeight} stroke="#c8ced6" />
          {visibleRows.map((row, index) => {
            const x = margin.left + index * (barWidth + gap) + ((plotWidth - (barWidth * visibleRows.length + gap * (visibleRows.length - 1))) / 2);
            const height = (row.count / max) * plotHeight;
            const y = margin.top + plotHeight - height;
            const selectRow = () => onSelect?.(row);
            return (
              <g
                key={row.label}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                className={onSelect ? 'cursor-pointer outline-none' : undefined}
                aria-label={onSelect ? `Show ${row.count.toLocaleString()} issue${row.count === 1 ? '' : 's'} for ${row.label}` : undefined}
                onClick={selectRow}
                onKeyDown={(event) => {
                  if (!onSelect) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectRow();
                  }
                }}
              >
                <rect x={x} y={y} width={barWidth} height={height} rx="5" fill={row.colour ?? '#6b7b92'} opacity="0.96" />
                {onSelect && <rect x={x - 5} y={margin.top} width={barWidth + 10} height={plotHeight} fill="transparent" />}
                <text x={x + barWidth / 2} y={margin.top + plotHeight + 28} textAnchor="end" transform={`rotate(-35 ${x + barWidth / 2} ${margin.top + plotHeight + 28})`} fill="#555f6d" fontSize="12">
                  {row.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function IssueDonutChart({ title, rows, onSelect }: { title: string; rows: IssueChartRow[]; onSelect?: (row: IssueChartRow) => void }) {
  const visibleRows = rows.filter((row) => row.count > 0);
  const total = visibleRows.reduce((sum, row) => sum + row.count, 0);
  const radius = 86;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="panel rounded-lg p-4">
      <ChartTitle title={title} />
      <div className="mt-4 flex min-h-[360px] flex-col items-center justify-center">
        <div className="mb-3 flex max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-600">
          {rows.map((row) => (
            <button
              key={row.label}
              type="button"
              className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-sm outline-none', onSelect && 'cursor-pointer hover:text-slate-950 focus:ring-2 focus:ring-ecu-teal/40')}
              onClick={() => onSelect?.(row)}
              disabled={!onSelect || row.count === 0}
              aria-label={`Show ${row.count.toLocaleString()} issue${row.count === 1 ? '' : 's'} for ${row.label}`}
            >
              <span className="h-2.5 w-10" style={{ backgroundColor: row.colour ?? '#6b7b92' }} />
              {row.label}
            </button>
          ))}
        </div>
        <svg className="h-[300px] w-full max-w-[520px]" viewBox="0 0 240 240" role="img" aria-label={title}>
          <circle cx="120" cy="120" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="52" />
          {visibleRows.map((row) => {
            const dash = total > 0 ? (row.count / total) * circumference : 0;
            const selectRow = () => onSelect?.(row);
            const segment = (
              <circle
                key={row.label}
                cx="120"
                cy="120"
                r={radius}
                fill="none"
                stroke={row.colour ?? '#6b7b92'}
                strokeDasharray={`${Math.max(0, dash - 2)} ${circumference}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                strokeWidth="52"
                transform="rotate(-90 120 120)"
                className={onSelect ? 'cursor-pointer outline-none' : undefined}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={onSelect ? `Show ${row.count.toLocaleString()} issue${row.count === 1 ? '' : 's'} for ${row.label}` : undefined}
                onClick={selectRow}
                onKeyDown={(event) => {
                  if (!onSelect) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectRow();
                  }
                }}
              />
            );
            offset += dash;
            return segment;
          })}
          <circle cx="120" cy="120" r="58" fill="white" />
        </svg>
      </div>
    </div>
  );
}

function ChartTitle({ title }: { title: string }) {
  return (
    <div>
      <h3 className="font-bold text-slate-950">{title}</h3>
      <div className="mt-2 h-0.5 w-10 bg-ecu-teal" />
    </div>
  );
}

function ReportCard({ title, detail, action }: { title: string; detail: string; action: ReactNode }) {
  return (
    <div className="panel rounded-lg p-5">
      <h3 className="font-bold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function IssueFieldGrid({ issue }: { issue: Issue }) {
  const rows = [
    ['Contact person', issue.contactPerson],
    ['Room number', issue.roomCode],
    ['Room name', issue.roomName],
    ['Priority', issue.priority],
    ['Responsible person', issue.responsiblePerson],
    ['Source category', issue.sourceCategory],
    ['Date identified', formatIssueDate(issue.dateIdentified)],
    ['Date closed', formatIssueDate(issue.dateClosed)],
    ['Aconex ref', issue.aconexRef],
    ['Aconex defect #', issue.aconexFieldDefect],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-200 p-3">
          <p className="label">{label}</p>
          <p className="mt-1 break-words text-sm font-semibold text-slate-800">{value || '-'}</p>
        </div>
      ))}
    </div>
  );
}

function exportIssuesCsv(issues: Issue[]) {
  downloadCsv('issues-register-export.csv', issues.map((issue) => ({
    businessUnit: issue.businessUnitName,
    issueId: issue.issueId,
    dateIdentified: issue.dateIdentified,
    contactPerson: issue.contactPerson,
    roomCode: issue.roomCode,
    roomName: issue.roomName,
    subject: issue.subject,
    detail: issue.detail,
    priority: issue.priority,
    category: issue.category,
    isChangeRequest: issue.isChangeRequest ? 'Yes' : 'No',
    responsiblePerson: issue.responsiblePerson,
    status: issue.status,
    sourceWorksheet: issue.originalWorksheet,
    sourceRow: issue.originalRowNumber,
  })));
}

function exportIssueDetailPdf(issue: Issue, attachments: IssueAttachmentReference[]) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`Issue ${issue.issueId}`, 14, 18);
  doc.setFontSize(10);
  const lines = [
    `Business unit: ${issue.businessUnitName}`,
    `Room: ${issue.roomCode || '-'} ${issue.roomName || ''}`,
    `Status: ${issue.status}`,
    `Category: ${issue.category}`,
    `Change request: ${issue.isChangeRequest ? 'Yes' : 'No'}`,
    `Responsible: ${issue.responsiblePerson || '-'}`,
    `Priority: ${issue.priority || '-'}`,
    `Date identified: ${issue.dateIdentified || '-'}`,
    `Subject: ${issue.subject || '-'}`,
    '',
    'Detail:',
    issue.detail || '-',
    '',
    'References:',
    ...(attachments.length ? attachments.map((item) => `${item.label}${item.url ? ` - ${item.url}` : ''}`) : [issue.photoReference || '-']),
  ];
  let y = 32;
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, 180);
    doc.text(wrapped, 14, y);
    y += wrapped.length * 6;
    if (y > 280) {
      doc.addPage();
      y = 18;
    }
  });
  doc.save(`issue-${issue.issueId.replace(/[^a-z0-9]+/gi, '-')}.pdf`);
}

function DataLoadProgressBanner({ progress }: { progress: RoomDataLoadProgress }) {
  return (
    <div className="border-b border-ecu-teal/30 bg-ecu-mint px-4 py-3 text-sm text-slate-800 lg:px-8" role="status" aria-live="polite">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="loading-spinner h-4 w-4" aria-hidden="true" />
          <span className="font-semibold">{progress.message}</span>
          <span className="text-slate-600">
            {progress.completedSteps}/{progress.totalSteps} datasets
            {progress.loadedRows ? ` - ${progress.loadedRows.toLocaleString()} rows` : ''}
          </span>
        </div>
        <span className="font-bold text-ecu-black">{progress.percent}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-2 rounded-full bg-ecu-teal transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}

const uploadedFloorplansStorageKey = 'ecu-room-data-uploaded-floorplans';
const uploadedFloorplansDbName = 'ecu-room-data-floorplans';
const uploadedFloorplansStoreName = 'uploaded-floorplans';

function loadUploadedFloorplansFromLocalStorage() {
  try {
    const value = window.localStorage.getItem(uploadedFloorplansStorageKey);
    if (!value) return [];
    const parsed = JSON.parse(value) as FloorplanDefinition[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLegacyUploadedFloorplansStorage() {
  try {
    window.localStorage.removeItem(uploadedFloorplansStorageKey);
  } catch {
    // Legacy cleanup is best-effort only.
  }
}

function openUploadedFloorplansDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('This browser does not support persistent floorplan storage.'));
      return;
    }

    const request = window.indexedDB.open(uploadedFloorplansDbName, 1);
    request.onerror = () => reject(request.error ?? new Error('Could not open floorplan storage.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(uploadedFloorplansStoreName)) {
        db.createObjectStore(uploadedFloorplansStoreName, { keyPath: 'id' });
      }
    };
  });
}

async function loadLocalUploadedFloorplans() {
  try {
    const db = await openUploadedFloorplansDb();
    return await new Promise<FloorplanDefinition[]>((resolve, reject) => {
      const transaction = db.transaction(uploadedFloorplansStoreName, 'readonly');
      const request = transaction.objectStore(uploadedFloorplansStoreName).getAll();
      request.onerror = () => reject(request.error ?? new Error('Could not load uploaded floorplans.'));
      request.onsuccess = () => resolve(request.result as FloorplanDefinition[]);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return loadUploadedFloorplansFromLocalStorage();
  }
}

async function saveLocalUploadedFloorplans(items: FloorplanDefinition[]) {
  try {
    const db = await openUploadedFloorplansDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(uploadedFloorplansStoreName, 'readwrite');
      const store = transaction.objectStore(uploadedFloorplansStoreName);
      store.clear();
      items.forEach((item) => store.put(item));
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save uploaded floorplans.'));
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
    });
    clearLegacyUploadedFloorplansStorage();
  } catch {
    // Uploaded floorplans still work for the current session if persistent browser storage is unavailable.
  }
}

function isPdfTextItem(item: unknown): item is TextItem {
  return Boolean(item && typeof item === 'object' && 'str' in item && 'transform' in item);
}

function normalizeUploadedRoomFragment(fragment: string) {
  return fragment.replace(/\s+/g, '').toUpperCase();
}

function normalizeFloorplanFloorLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'Uploaded floor';
  const compact = trimmed.toLowerCase().replace(/\s+/g, '');
  if (compact === 'g' || compact === 'ground' || compact === 'lg') return 'Ground';
  const levelMatch = compact.match(/^(?:l|level)?(\d+)$/);
  if (levelMatch) return `Level ${Number(levelMatch[1])}`;
  return trimmed.replace(/\blevel\s*(\d+)\b/i, (_match, level) => `Level ${Number(level)}`);
}

function detectRoomName(text: string, roomFragment: string, previousLabel: string) {
  const beforeCode = text.slice(0, text.toUpperCase().indexOf(roomFragment.toUpperCase())).trim();
  return beforeCode || previousLabel || undefined;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the PDF file.'));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToArrayBuffer(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
}

async function convertPdfDataToFloorplan({
  pdfData,
  id,
  campusCode,
  buildingCode,
  buildingName,
  floor,
  zone,
  roomCodePrefix,
  originalFileName,
  sourcePdfDataUrl,
}: {
  pdfData: ArrayBuffer;
  id?: string;
  campusCode: string;
  buildingCode: string;
  buildingName: string;
  floor: string;
  zone: FloorplanZone;
  roomCodePrefix: string;
  originalFileName: string;
  sourcePdfDataUrl?: string;
}): Promise<FloorplanDefinition> {
  const pdf = await getDocument({ data: pdfData.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const textViewport = page.getViewport({ scale: 1 });
  const renderScale = Math.min(2, 2400 / textViewport.width, 1800 / textViewport.height);
  const viewport = page.getViewport({ scale: renderScale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare a canvas for the PDF floorplan.');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;

  const textContent = await page.getTextContent();
  const roomPattern = /\b\d+[A-Z]\.[A-Z0-9]+[A-Z]?\b/g;
  const hotspots: FloorplanHotspot[] = [];
  let previousLabel = '';

  textContent.items.filter(isPdfTextItem).forEach((item) => {
    const rawText = item.str.trim();
    if (!rawText) return;
    const matches = [...rawText.matchAll(roomPattern)];
    if (!matches.length) {
      if (!/^\[.*\]$/.test(rawText)) previousLabel = rawText;
      return;
    }

    matches.forEach((match) => {
      const fragment = normalizeUploadedRoomFragment(match[0]);
      const textMatrix = Util.transform(textViewport.transform, item.transform);
      const [a, b, c, d, x, baselineY] = textMatrix;
      const fontHeight = Math.max(Math.hypot(c, d), Math.hypot(a, b), 8);
      const estimatedWidth = Math.max(item.width || 0, fragment.length * Math.max(Math.abs(fontHeight), 8) * 0.55);
      const estimatedHeight = Math.max(Math.abs(fontHeight) * 1.45, 14);
      const rectX = Math.max(0, (x / textViewport.width) * 100 - 0.8);
      const rectY = Math.max(0, ((baselineY - estimatedHeight) / textViewport.height) * 100 - 0.8);
      const rectWidth = Math.min(100 - rectX, (estimatedWidth / textViewport.width) * 100 + 1.6);
      const rectHeight = Math.min(100 - rectY, (estimatedHeight / textViewport.height) * 100 + 1.6);
      hotspots.push({
        roomCode: `${roomCodePrefix}.${fragment}`,
        roomName: detectRoomName(rawText, fragment, previousLabel),
        shape: 'rect',
        points: [rectX, rectY, Math.max(rectWidth, 3), Math.max(rectHeight, 2.5)],
      });
    });
    previousLabel = '';
  });

  await pdf.destroy();
  return {
    id: id ?? `uploaded-${Date.now()}`,
    campusCode,
    buildingCode,
    buildingName,
    floor: normalizeFloorplanFloorLabel(floor),
    zone,
    imagePath: canvas.toDataURL('image/png'),
    imageAlt: `${buildingName || buildingCode} ${floor} ${zone} uploaded floorplan`,
    source: 'uploaded-pdf',
    uploadedAt: new Date().toISOString(),
    originalFileName,
    sourcePdfDataUrl,
    hotspots,
  };
}

async function convertPdfToFloorplan({
  file,
  campusCode,
  buildingCode,
  buildingName,
  floor,
  zone,
  roomCodePrefix,
}: {
  file: File;
  campusCode: string;
  buildingCode: string;
  buildingName: string;
  floor: string;
  zone: FloorplanZone;
  roomCodePrefix: string;
}): Promise<FloorplanDefinition> {
  const sourcePdfDataUrl = await readFileAsDataUrl(file);
  return convertPdfDataToFloorplan({
    pdfData: await dataUrlToArrayBuffer(sourcePdfDataUrl),
    campusCode,
    buildingCode,
    buildingName,
    floor,
    zone,
    roomCodePrefix,
    originalFileName: file.name,
    sourcePdfDataUrl,
  });
}

function FloorplansPage({
  rooms,
  campuses,
  buildings,
  openRoomProfile,
}: {
  rooms: Room[];
  campuses: Campus[];
  buildings: Building[];
  openRoomProfile: (roomCode: string) => void;
}) {
  const [uploadedFloorplans, setUploadedFloorplans] = useState<FloorplanDefinition[]>([]);
  const [floorplanStatus, setFloorplanStatus] = useState('');
  const [reassessingFloorplanId, setReassessingFloorplanId] = useState('');
  const campusOptions = useMemo(() => {
    const codes = [
      ...campuses.map((campus) => campus.code),
      ...uploadedFloorplans.map((floorplan) => floorplan.campusCode),
      ...floorplans.map((floorplan) => floorplan.campusCode),
    ].filter((code): code is string => Boolean(code));
    return Array.from(new Set(['CC', ...codes])).sort((a, b) => (a === 'CC' ? -1 : b === 'CC' ? 1 : a.localeCompare(b)));
  }, [campuses, uploadedFloorplans]);
  const [selectedCampus, setSelectedCampus] = useState('CC');
  const allFloorplans = useMemo(() => [...uploadedFloorplans, ...floorplans], [uploadedFloorplans]);
  const campusFloorplans = useMemo(
    () => allFloorplans.filter((floorplan) => (floorplan.campusCode || 'CC') === selectedCampus),
    [allFloorplans, selectedCampus],
  );
  const sortedFloorplans = useMemo(() => [...campusFloorplans].sort((a, b) => floorSortValue(a.floor) - floorSortValue(b.floor) || a.zone.localeCompare(b.zone)), [campusFloorplans]);
  const floorOptions = useMemo(() => Array.from(new Set(sortedFloorplans.map((floorplan) => floorplan.floor))), [sortedFloorplans]);
  const [selectedFloor, setSelectedFloor] = useState(floorOptions[0] ?? 'Level 1');
  const zoneOptions = useMemo(
    () => Array.from(new Set(sortedFloorplans.filter((floorplan) => floorplan.floor === selectedFloor).map((floorplan) => floorplan.zone))),
    [selectedFloor, sortedFloorplans],
  );
  const [selectedZone, setSelectedZone] = useState<FloorplanZone>(zoneOptions[0] ?? 'North');
  const selectedFloorplan = campusFloorplans.find((floorplan) => floorplan.floor === selectedFloor && floorplan.zone === selectedZone);
  const roomMetadata = useMemo(() => {
    return rooms.reduce<Map<string, Room>>((metadata, room) => {
      metadata.set(normalizeRoomCodeKey(room.roomCode), room);
      return metadata;
    }, new Map());
  }, [rooms]);

  useEffect(() => {
    let isMounted = true;
    Promise.resolve()
      .then(async () => {
        if (isSupabaseConfigured) return loadSharedFloorplansFromSupabase();
        return loadLocalUploadedFloorplans();
      })
      .then((items) => {
        if (isMounted) setUploadedFloorplans(items);
      })
      .catch((error) => {
        if (isMounted) {
          setFloorplanStatus(error instanceof Error ? error.message : 'Could not load shared floorplans.');
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!campusOptions.includes(selectedCampus)) setSelectedCampus('CC');
  }, [campusOptions, selectedCampus]);

  useEffect(() => {
    if (!floorOptions.includes(selectedFloor) && floorOptions[0]) setSelectedFloor(floorOptions[0]);
  }, [floorOptions, selectedFloor]);

  useEffect(() => {
    if (!zoneOptions.includes(selectedZone) && zoneOptions[0]) setSelectedZone(zoneOptions[0]);
  }, [selectedZone, zoneOptions]);

  const mergeUploadedFloorplan = (floorplan: FloorplanDefinition) => {
    setUploadedFloorplans((current) => {
      const next = [
        floorplan,
        ...current.filter((item) => !(
          item.id === floorplan.id
          || (
            item.campusCode === floorplan.campusCode
            && item.buildingCode === floorplan.buildingCode
            && item.floor === floorplan.floor
            && item.zone === floorplan.zone
          )
        )),
      ];
      if (!isSupabaseConfigured) void saveLocalUploadedFloorplans(next);
      return next;
    });
    setSelectedFloor(floorplan.floor);
    setSelectedZone(floorplan.zone);
    setSelectedCampus(floorplan.campusCode || 'CC');
  };

  const addUploadedFloorplan = async (floorplan: FloorplanDefinition) => {
    setFloorplanStatus(isSupabaseConfigured ? 'Saving shared floorplan to Supabase...' : '');
    const savedFloorplan = isSupabaseConfigured ? await saveSharedFloorplanToSupabase(floorplan) : floorplan;
    mergeUploadedFloorplan(savedFloorplan);
    setFloorplanStatus(isSupabaseConfigured ? 'Shared floorplan saved for all users.' : '');
    return savedFloorplan;
  };

  const deleteUploadedFloorplan = async (floorplan: FloorplanDefinition) => {
    if (!window.confirm(`Delete the "${floorplan.floor} / ${floorplan.zone}" floorplan? This cannot be undone.`)) return;
    setFloorplanStatus('Deleting floorplan...');
    try {
      if (isSupabaseConfigured) await deleteSharedFloorplanFromSupabase(floorplan.id);
      setUploadedFloorplans((current) => {
        const next = current.filter((item) => item.id !== floorplan.id);
        if (!isSupabaseConfigured) void saveLocalUploadedFloorplans(next);
        return next;
      });
      setFloorplanStatus('Floorplan deleted.');
    } catch (error) {
      setFloorplanStatus(error instanceof Error ? error.message : 'Could not delete floorplan.');
    }
  };

  const replaceUploadedFloorplan = async (floorplan: FloorplanDefinition) => {
    const savedFloorplan = isSupabaseConfigured ? await saveSharedFloorplanToSupabase(floorplan) : floorplan;
    setUploadedFloorplans((current) => {
      const next = current.map((item) => (item.id === savedFloorplan.id ? savedFloorplan : item));
      if (!isSupabaseConfigured) void saveLocalUploadedFloorplans(next);
      return next;
    });
    return savedFloorplan;
  };

  const reassessUploadedFloorplan = async (floorplan: FloorplanDefinition) => {
    if (!floorplan.sourcePdfDataUrl) {
      setFloorplanStatus('This uploaded floorplan cannot be re-assessed because the original PDF is not available in browser storage. Upload the PDF again to create fresh hotspots.');
      return;
    }

    setReassessingFloorplanId(floorplan.id);
    setFloorplanStatus('Re-assessing PDF text positions and clickable hotspots...');
    try {
      const reassessed = await convertPdfDataToFloorplan({
        pdfData: await dataUrlToArrayBuffer(floorplan.sourcePdfDataUrl),
        id: floorplan.id,
        campusCode: floorplan.campusCode || floorplan.hotspots[0]?.roomCode.split('.')[0] || 'CC',
        buildingCode: floorplan.buildingCode || '',
        buildingName: floorplan.buildingName || floorplan.buildingCode || 'Building',
        floor: floorplan.floor,
        zone: floorplan.zone,
        roomCodePrefix: floorplan.hotspots[0]?.roomCode.split('.')[0] || floorplan.campusCode || 'CC',
        originalFileName: floorplan.originalFileName || 'Uploaded floorplan.pdf',
        sourcePdfDataUrl: floorplan.sourcePdfDataUrl,
      });
      const saved = await replaceUploadedFloorplan(reassessed);
      setFloorplanStatus(`Re-assessed ${saved.hotspots.length} clickable room hotspot${saved.hotspots.length === 1 ? '' : 's'}${isSupabaseConfigured ? ' and saved it for all users' : ''}.`);
    } catch (error) {
      setFloorplanStatus(error instanceof Error ? error.message : 'Could not re-assess this uploaded PDF floorplan.');
    } finally {
      setReassessingFloorplanId('');
    }
  };

  return (
    <>
      <PageHeader
        title="Floorplans"
        description="Choose an ECU City Campus floor and wing, then select a mapped room to open Room Search for that room."
      />
      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="grid gap-5">
          <FloorSelector
            campusOptions={campusOptions}
            selectedCampus={selectedCampus}
            setSelectedCampus={setSelectedCampus}
            floorOptions={floorOptions}
            zoneOptions={zoneOptions}
            selectedFloor={selectedFloor}
            selectedZone={selectedZone}
            selectedFloorplan={selectedFloorplan}
            setSelectedFloor={setSelectedFloor}
            setSelectedZone={setSelectedZone}
          />
          <FloorplanPdfUpload campuses={campuses} buildings={buildings} onUploaded={addUploadedFloorplan} />
        </div>
        {selectedFloorplan ? (
          <FloorplanViewer
            floorplan={selectedFloorplan}
            roomMetadata={roomMetadata}
            openRoomProfile={openRoomProfile}
            onReassess={selectedFloorplan.source === 'uploaded-pdf' ? reassessUploadedFloorplan : undefined}
            onDelete={uploadedFloorplans.some((f) => f.id === selectedFloorplan.id) ? deleteUploadedFloorplan : undefined}
            isReassessing={reassessingFloorplanId === selectedFloorplan.id}
            reassessStatus={floorplanStatus}
          />
        ) : (
          <div className="panel flex min-h-[420px] items-center justify-center rounded-lg p-8 text-center">
            <div>
              <MapIcon className="mx-auto text-slate-300" size={44} />
              <h2 className="mt-4 text-xl font-bold text-slate-950">No floorplan yet</h2>
              <p className="mt-2 max-w-md text-sm text-slate-600">
                There is no configured floorplan for {selectedFloor} {selectedZone}. Add an image under public/floorplans/ and map it in src/data/floorplans.ts.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FloorSelector({
  campusOptions,
  selectedCampus,
  setSelectedCampus,
  floorOptions,
  zoneOptions,
  selectedFloor,
  selectedZone,
  selectedFloorplan,
  setSelectedFloor,
  setSelectedZone,
}: {
  campusOptions: string[];
  selectedCampus: string;
  setSelectedCampus: (campus: string) => void;
  floorOptions: string[];
  zoneOptions: FloorplanZone[];
  selectedFloor: string;
  selectedZone: FloorplanZone;
  selectedFloorplan?: FloorplanDefinition;
  setSelectedFloor: (floor: string) => void;
  setSelectedZone: (zone: FloorplanZone) => void;
}) {
  return (
    <div className="panel rounded-lg p-4">
      <SectionTitle icon={MapIcon} title="Select Floorplan" />
      <div className="mt-4 grid gap-4">
        <FilterSelect label="Campus" value={selectedCampus} setValue={setSelectedCampus} options={campusOptions} />
        <FilterSelect label="Floor level" value={selectedFloor} setValue={setSelectedFloor} options={floorOptions} />
        <div>
          <label className="label">Building zone</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(['North', 'South', 'Both'] as FloorplanZone[]).map((zone) => {
              const isAvailable = zoneOptions.includes(zone);
              return (
                <button
                  key={zone}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => setSelectedZone(zone)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40',
                    selectedZone === zone && isAvailable
                      ? 'border-ecu-teal bg-ecu-mint text-ecu-black'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-ecu-teal',
                  )}
                >
                  {zone}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="label">Current selection</p>
          <p className="mt-1 font-bold text-slate-950">{selectedFloor} / {selectedZone}</p>
          <p className="mt-1 text-sm text-slate-600">
            {selectedFloorplan ? `${selectedFloorplan.hotspots.length} clickable room hotspot${selectedFloorplan.hotspots.length === 1 ? '' : 's'} configured.` : 'No floorplan configured for this combination.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function FloorplanPdfUpload({
  campuses,
  buildings,
  onUploaded,
}: {
  campuses: Campus[];
  buildings: Building[];
  onUploaded: (floorplan: FloorplanDefinition) => Promise<FloorplanDefinition>;
}) {
  const defaultCampusCode = campuses.some((campus) => campus.code === 'CC') ? 'CC' : campuses[0]?.code || 'CC';
  const [campusCode, setCampusCode] = useState(defaultCampusCode);
  const campusBuildings = useMemo(() => buildings.filter((building) => building.campusCode === campusCode), [buildings, campusCode]);
  const [buildingCode, setBuildingCode] = useState(campusBuildings[0]?.code || '1');
  const [floor, setFloor] = useState('Level 4');
  const [zone, setZone] = useState<FloorplanZone>('South');
  const [roomCodePrefix, setRoomCodePrefix] = useState(defaultCampusCode);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!campuses.some((campus) => campus.code === campusCode) && defaultCampusCode) {
      setCampusCode(defaultCampusCode);
      setRoomCodePrefix(defaultCampusCode);
    }
  }, [campusCode, campuses, defaultCampusCode]);

  useEffect(() => {
    if (!campusBuildings.some((building) => building.code === buildingCode)) {
      setBuildingCode(campusBuildings[0]?.code || '');
    }
  }, [buildingCode, campusBuildings]);

  const handleCampusChange = (value: string) => {
    setCampusCode(value);
    setRoomCodePrefix(value);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setStatus('');
  };

  const uploadPdf = async () => {
    if (!file) {
      setStatus('Choose a PDF floorplan first.');
      return;
    }
    if (!roomCodePrefix.trim()) {
      setStatus('Choose the room code prefix, for example CC.');
      return;
    }

    setIsProcessing(true);
    setStatus('Reading PDF text and rendering the first page...');
    try {
      const building = buildings.find((item) => item.code === buildingCode && item.campusCode === campusCode);
      const converted = await convertPdfToFloorplan({
        file,
        campusCode,
        buildingCode,
        buildingName: building?.name || buildingCode || 'Building',
        floor: normalizeFloorplanFloorLabel(floor),
        zone,
        roomCodePrefix: roomCodePrefix.trim().toUpperCase(),
      });
      const saved = await onUploaded(converted);
      setStatus(`Created ${saved.hotspots.length} clickable room hotspot${saved.hotspots.length === 1 ? '' : 's'} from ${file.name}${isSupabaseConfigured ? ' and saved it for all users' : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not convert this PDF floorplan.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="panel rounded-lg p-4">
      <SectionTitle icon={Upload} title="Upload PDF Floorplan" />
      <div className="mt-4 grid gap-4">
        <div>
          <label className="label" htmlFor="floorplan-pdf">PDF floorplan</label>
          <input id="floorplan-pdf" className="input mt-1" type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <FilterSelect label="Campus" value={campusCode} setValue={handleCampusChange} options={campuses.map((campus) => campus.code)} />
          <FilterSelect label="Building" value={buildingCode} setValue={setBuildingCode} options={campusBuildings.map((building) => building.code)} />
          <div>
            <label className="label" htmlFor="uploaded-floor">Floor</label>
            <input id="uploaded-floor" className="input mt-1" value={floor} onChange={(event) => setFloor(event.target.value)} placeholder="Level 4" />
          </div>
          <FilterSelect label="Zone" value={zone} setValue={(value) => setZone(value as FloorplanZone)} options={['North', 'South', 'Both']} />
          <div>
            <label className="label" htmlFor="room-code-prefix">Room code prefix</label>
            <input id="room-code-prefix" className="input mt-1 uppercase" value={roomCodePrefix} onChange={(event) => setRoomCodePrefix(event.target.value)} placeholder="CC" />
            <p className="mt-1 text-xs text-slate-500">PDF labels like 1S.450 become {roomCodePrefix || 'CC'}.1S.450.</p>
          </div>
        </div>
        <button type="button" className="btn-primary w-full" disabled={isProcessing} onClick={uploadPdf}>
          {isProcessing ? <span className="loading-spinner h-4 w-4" aria-hidden="true" /> : <Upload size={16} />}
          {isProcessing ? 'Converting PDF' : 'Convert to Floorplan'}
        </button>
        {status && (
          <p className={cn('rounded-md border p-3 text-sm', status.startsWith('Created') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600')}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}

function FloorplanViewer({
  floorplan,
  roomMetadata,
  openRoomProfile,
  onReassess,
  onDelete,
  isReassessing = false,
  reassessStatus,
}: {
  floorplan: FloorplanDefinition;
  roomMetadata: Map<string, Room>;
  openRoomProfile: (roomCode: string) => void;
  onReassess?: (floorplan: FloorplanDefinition) => void;
  onDelete?: (floorplan: FloorplanDefinition) => void;
  isReassessing?: boolean;
  reassessStatus?: string;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [activeRoomCode, setActiveRoomCode] = useState('');
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [floorplan.id]);

  const updateScale = (nextScale: number) => {
    setScale(Math.min(3, Math.max(0.7, nextScale)));
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    panStart.current = { x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    setOffset({
      x: panStart.current.offsetX + event.clientX - panStart.current.x,
      y: panStart.current.offsetY + event.clientY - panStart.current.y,
    });
  };

  const stopPanning = () => setIsPanning(false);
  const activeRoom = activeRoomCode ? roomMetadata.get(normalizeRoomCodeKey(activeRoomCode)) : undefined;
  const activeHotspot = activeRoomCode ? floorplan.hotspots.find((hotspot) => hotspot.roomCode === activeRoomCode) : undefined;
  const activeRoomName = activeRoom ? roomDisplayName(activeRoom) : activeHotspot?.roomName;
  const activeRoomType = activeRoom?.type || activeRoom?.pattern || activeHotspot?.roomType;

  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="label">{floorplan.campusCode || 'ECU City Campus'}{floorplan.buildingName ? ` / ${floorplan.buildingName}` : ''}</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">{floorplan.floor} / {floorplan.zone}</h2>
          {floorplan.source === 'uploaded-pdf' && <p className="mt-1 text-sm text-slate-500">Uploaded from {floorplan.originalFileName}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {onReassess && (
            <button type="button" className="btn-secondary" disabled={isReassessing} onClick={() => onReassess(floorplan)}>
              {isReassessing ? <span className="loading-spinner h-4 w-4" aria-hidden="true" /> : <RefreshCcw size={16} />}
              Re-assess hotspots
            </button>
          )}
          {onDelete && (
            <button type="button" className="btn-secondary text-red-600 hover:border-red-300 hover:bg-red-50" onClick={() => onDelete(floorplan)}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => updateScale(scale + 0.2)} aria-label="Zoom in"><Plus size={16} /> Zoom</button>
          <button type="button" className="btn-secondary" onClick={() => updateScale(scale - 0.2)} aria-label="Zoom out"><Minus size={16} /> Zoom</button>
          <button type="button" className="btn-secondary" onClick={resetView}><RefreshCcw size={16} /> Reset</button>
          <button type="button" className="btn-secondary" onClick={resetView}><Maximize2 size={16} /> Fit</button>
        </div>
        {reassessStatus && floorplan.source === 'uploaded-pdf' && (
          <p className={cn('rounded-md border px-3 py-2 text-sm', reassessStatus.startsWith('Re-assessed') ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600')}>
            {reassessStatus}
          </p>
        )}
      </div>
      <div
        className={cn('relative h-[62vh] min-h-[420px] overflow-hidden bg-slate-100 touch-none', isPanning ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        onWheel={(event) => {
          event.preventDefault();
          updateScale(scale + (event.deltaY < 0 ? 0.12 : -0.12));
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 w-[min(1120px,92vw)] origin-center"
          style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})` }}
        >
          <div className="relative rounded-md bg-white shadow-panel">
            <img src={floorplan.imagePath} alt={floorplan.imageAlt} className="block h-auto w-full select-none rounded-md" draggable={false} />
            <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Clickable room hotspots">
              {floorplan.hotspots.map((hotspot) => (
                <RoomHotspot
                  key={hotspot.roomCode}
                  hotspot={hotspot}
                  room={roomMetadata.get(normalizeRoomCodeKey(hotspot.roomCode))}
                  activeRoomCode={activeRoomCode}
                  setActiveRoomCode={setActiveRoomCode}
                  openRoomProfile={openRoomProfile}
                />
              ))}
            </svg>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-white/80 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-600 shadow-panel">
          <Move size={14} className="mr-1 inline" /> Drag to pan. Use controls or mouse wheel to zoom.
        </div>
        {activeRoomCode && (
          <div className="pointer-events-none absolute right-4 top-4 max-w-xs rounded-md border border-slate-200 bg-white p-3 text-sm shadow-panel">
            <p className="font-bold text-slate-950">{activeRoomCode}</p>
            <p className="mt-1 text-slate-700">{activeRoomName || 'Room metadata unavailable'}</p>
            {activeRoomType && <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{activeRoomType}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function RoomHotspot({
  hotspot,
  room,
  activeRoomCode,
  setActiveRoomCode,
  openRoomProfile,
}: {
  hotspot: FloorplanHotspot;
  room?: Room;
  activeRoomCode: string;
  setActiveRoomCode: (roomCode: string) => void;
  openRoomProfile: (roomCode: string) => void;
}) {
  const isActive = activeRoomCode === hotspot.roomCode;
  const commonProps = {
    role: 'button',
    tabIndex: 0,
    className: cn('cursor-pointer outline-none transition', isActive ? 'fill-ecu-teal/35 stroke-ecu-black' : 'fill-ecu-teal/15 stroke-ecu-teal hover:fill-ecu-teal/30'),
    strokeWidth: 0.45,
    vectorEffect: 'non-scaling-stroke',
    onPointerDown: (event: ReactPointerEvent<SVGElement>) => event.stopPropagation(),
    onPointerEnter: () => setActiveRoomCode(hotspot.roomCode),
    onPointerLeave: () => setActiveRoomCode(''),
    onFocus: () => setActiveRoomCode(hotspot.roomCode),
    onBlur: () => setActiveRoomCode(''),
    onClick: () => openRoomProfile(hotspot.roomCode),
    onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openRoomProfile(hotspot.roomCode);
      }
    },
    'aria-label': `Open Room Profile for ${hotspot.roomCode}${room ? `, ${roomDisplayName(room)}` : hotspot.roomName ? `, ${hotspot.roomName}` : ''}`,
  };

  if (hotspot.shape === 'polygon') {
    const pointPairs = [];
    for (let index = 0; index < hotspot.points.length; index += 2) {
      pointPairs.push(`${hotspot.points[index]},${hotspot.points[index + 1]}`);
    }
    return <polygon {...commonProps} points={pointPairs.join(' ')} />;
  }

  const [x, y, width, height] = hotspot.points;
  return <rect {...commonProps} x={x} y={y} width={width} height={height} rx={1.2} />;
}

function RoomSearch({
  rooms,
  campuses,
  attributes,
  openRoom,
  roomDataLoading,
  loadProgress,
  summaryFilter,
  clearSummaryFilter,
  initialSearch,
}: {
  rooms: Room[];
  campuses: Campus[];
  attributes: AttributeDefinition[];
  openRoom: (id: string) => void;
  roomDataLoading: boolean;
  loadProgress: RoomDataLoadProgress | null;
  summaryFilter: string | null;
  clearSummaryFilter: () => void;
  initialSearch: string;
}) {
  const [query, setQuery] = useState(initialSearch);
  const [campus, setCampus] = useState('All');
  const [category, setCategory] = useState('All');
  const [flags, setFlags] = useState<string[]>([]);
  const [minCapacity, setMinCapacity] = useState('');
  const [capability, setCapability] = useState('');
  const deferredQuery = useDeferredValue(query);
  const deferredCapability = useDeferredValue(capability);
  const deferredMinCapacity = useDeferredValue(minCapacity);

  useEffect(() => {
    setQuery(initialSearch);
  }, [initialSearch]);
  const searchIndex = useMemo(() => rooms.map((room) => ({
    room,
    displayName: roomDisplayName(room),
    searchText: [
      room.roomCode,
      room.name,
      getRoomFinalName(room),
      roomDisplayName(room),
      room.campus,
      room.building,
      room.floor,
      room.type,
      room.owner,
      room.bookingStatus,
      room.pattern,
      getRoomCapacityDisplay(room, attributes),
      room.capabilities.join(' '),
      ...Object.values(room.attributes).map(formatAttributeValue),
    ].join(' ').toLowerCase(),
  })), [attributes, rooms]);
  const campusOptions = useMemo(() => {
    const names = [
      ...campuses.map((item) => item.name),
      ...rooms.map((room) => room.campus),
    ].filter((name) => name && !name.startsWith('Unmapped'));

    return ['All', ...Array.from(new Set(names)).sort((a, b) => a.localeCompare(b))];
  }, [campuses, rooms]);

  useEffect(() => {
    if (!campusOptions.includes(campus)) setCampus('All');
  }, [campus, campusOptions]);

  const filteredRooms = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const capabilitySearch = deferredCapability.trim().toLowerCase();
    const capacityFloor = Number(deferredMinCapacity);
    const activeSummaryRow = summaryFilter ? impactedSystemSummaryRows.find((summaryRow) => summaryRow.label === summaryFilter) : undefined;
    return searchIndex.filter(({ room, searchText }) => {
      const summaryMatch = !activeSummaryRow || activeSummaryRow.matches(room);
      const textMatch = !q || searchText.includes(q);
      const campusMatch = campus === 'All' || room.campus === campus;
      const categoryMatch = category === 'All' || room.category === category;
      const capacityMatch = !deferredMinCapacity || getRoomCapacityNumber(room, attributes) >= capacityFloor;
      const capabilityMatch = !capabilitySearch || room.capabilities.some((item) => item.toLowerCase().includes(capabilitySearch));
      const flagMatch = flags.every((flag) => {
        const quickFilter = roomQuickFilters.find((filter) => filter.label === flag);
        return quickFilter ? isTruthyAttributeValue(room.attributes[quickFilter.attributeKey]) : true;
      });
      return summaryMatch && textMatch && campusMatch && categoryMatch && capacityMatch && capabilityMatch && flagMatch;
    }).map(({ room }) => room);
  }, [attributes, searchIndex, deferredQuery, campus, category, flags, deferredMinCapacity, deferredCapability, summaryFilter]);
  const visibleRooms = filteredRooms.slice(0, roomSearchRenderLimit);

  const toggleFlag = (flag: string) => {
    setFlags((current) => (current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]));
  };

  return (
    <>
      <PageHeader
        title="Room Search"
        description="Search room code, name, campus, building, floor, type, owner, booking status, and capability with simple or advanced filters."
        action={<button className="btn-secondary" onClick={() => downloadCsv('room-data-export.csv', filteredRooms)}><Download size={16} /> Export CSV</button>}
      />
      <div className="panel rounded-lg p-4">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_0.7fr_1fr]">
          <div>
            <label className="label" htmlFor="search">Simple search</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input id="search" className="input pl-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Room code, owner, capability..." />
            </div>
          </div>
          <FilterSelect label="Campus" value={campus} setValue={setCampus} options={campusOptions} />
          <FilterSelect label="Category" value={category} setValue={setCategory} options={['All', ...categories.map((item) => item.name)]} />
          <div>
            <label className="label" htmlFor="capacity">Min capacity</label>
            <input id="capacity" className="input mt-1" type="number" min="0" value={minCapacity} onChange={(event) => setMinCapacity(event.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="capability">Capability</label>
            <input id="capability" className="input mt-1" value={capability} onChange={(event) => setCapability(event.target.value)} placeholder="Teams, piano..." />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {summaryFilter && (
            <button
              type="button"
              onClick={clearSummaryFilter}
              className="badge border-ecu-teal bg-ecu-mint text-ecu-black transition hover:bg-white"
            >
              {summaryFilter} results
              <span className="text-slate-500">Clear</span>
            </button>
          )}
          {roomQuickFilters.map(({ label }) => (
            <button
              key={label}
              onClick={() => toggleFlag(label)}
              className={cn('badge transition', flags.includes(label) ? 'border-ecu-teal bg-ecu-mint text-ecu-black' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {roomDataLoading && (
          <div className="panel rounded-lg p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="loading-spinner" aria-hidden="true" />
                <div>
                  <p className="font-bold text-slate-950">{loadProgress?.message ?? 'Loading room data'}</p>
                  <p className="mt-1 text-sm text-slate-600">Room Search will fill in as soon as Supabase finishes loading.</p>
                </div>
              </div>
              <span className="text-lg font-bold text-ecu-black">{loadProgress?.percent ?? 0}%</span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-ecu-teal transition-all" style={{ width: `${loadProgress?.percent ?? 0}%` }} />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing {visibleRooms.length.toLocaleString()} of {filteredRooms.length.toLocaleString()} matching room{filteredRooms.length === 1 ? '' : 's'}
          </p>
          {filteredRooms.length > roomSearchRenderLimit && (
            <p className="font-medium text-slate-700">Refine filters to narrow the result list, or export all matches.</p>
          )}
        </div>
        {visibleRooms.map((room) => {
          const attributeBadges = getVisibleRoomAttributeBadges(room, attributes, 6);
          return (
          <button key={room.id} onClick={() => openRoom(room.id)} className="panel rounded-lg p-4 text-left hover:border-ecu-teal">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 gap-3">
                <RoomFloorplanThumbnail imageUrl={room.floorplanImageUrl} roomName={roomDisplayName(room)} isDataLoading={roomDataLoading} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-950">{roomDisplayName(room)}</h3>
                    {getActiveRoomQualityFlags(room).length > 0 && <span className="badge border-amber-200 bg-amber-50 text-amber-700"><AlertTriangle size={13} /> Data flag</span>}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{room.campus} · {room.building} · {room.floor}</p>
                </div>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-4 lg:min-w-[560px]">
                <Fact label="Pattern" value={room.pattern} />
                <Fact label="Capacity" value={getRoomCapacityDisplay(room, attributes)} />
                <Fact label="Booking" value={room.bookingStatus} />
                <Fact label="Owner" value={room.owner} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {room.capabilities.slice(0, 5).map((capabilityItem) => <span key={capabilityItem} className="badge border-slate-200 bg-slate-50 text-slate-600">{capabilityItem}</span>)}
              {attributeBadges.map((attribute) => (
                <span key={attribute.key} className="badge border-ecu-teal/30 bg-ecu-mint text-ecu-black">
                  {attribute.label}: {attribute.value}
                </span>
              ))}
            </div>
          </button>
          );
        })}
      </div>
    </>
  );
}

function RoomFloorplanThumbnail({ imageUrl, roomName, isDataLoading }: { imageUrl?: string; roomName: string; isDataLoading: boolean }) {
  const thumbnailUrl = getRoomFloorplanThumbnailUrl(imageUrl);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const shouldShowLoader = (!thumbnailUrl && isDataLoading) || (Boolean(thumbnailUrl) && !isLoaded && !hasFailed);

  useEffect(() => {
    setIsLoaded(false);
    setHasFailed(false);
  }, [thumbnailUrl]);

  return (
    <div className="relative hidden h-20 w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 sm:flex sm:items-center sm:justify-center">
      {thumbnailUrl && !hasFailed ? (
        <img
          src={thumbnailUrl}
          alt={`Floorplan thumbnail for ${roomName}`}
          className={cn('h-full w-full object-contain transition-opacity duration-150', isLoaded ? 'opacity-100' : 'opacity-0')}
          loading="lazy"
          decoding="async"
          width="112"
          height="80"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasFailed(true)}
        />
      ) : shouldShowLoader ? null : (
        <ImageIcon size={22} className="text-slate-300" aria-hidden="true" />
      )}
      {shouldShowLoader && (
        <span className="absolute inset-0 flex items-center justify-center bg-slate-50" aria-label={`Loading floorplan thumbnail for ${roomName}`} role="status">
          <span className="loading-spinner h-5 w-5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}

function FilterSelect({ label, value, setValue, options }: { label: string; value: string; setValue: (value: string) => void; options: string[] }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input mt-1" value={value} onChange={(event) => setValue(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-1 font-semibold text-slate-800">{String(value)}</p>
    </div>
  );
}

type RoomProfileFieldRow = {
  key: string;
  tab: string;
  group: string;
  label: string;
  value: string;
  rawValue: string | number | boolean | string[];
  description: string;
  sourceSystem: string;
  type: AttributeDefinition['type'];
  required: boolean;
  updatedAt?: string;
};

const roomProfileTabs = ['Overview', 'Identification', 'Timetabling', 'Technology', 'Booking', 'Governance', 'History'];
const coreRoomProfileGroup = 'Core Room Details';

function RoomDetail({ room, rooms, setRooms, attributes, openRoomAdmin, requireAuthenticatedEdit }: {
  room: Room;
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  attributes: AttributeDefinition[];
  openRoomAdmin: (roomId: string) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const roomMappings = mappings.filter((mapping) => mapping.roomId === room.id);
  const [selectedTab, setSelectedTab] = useState('Overview');
  const [selectedFieldKey, setSelectedFieldKey] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set([coreRoomProfileGroup]));
  const [fieldSearch, setFieldSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All sources');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [emptyOnly, setEmptyOnly] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editingValue, setEditingValue] = useState('');
  const [toast, setToast] = useState('');
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const attributeDefinitions = useMemo(() => getRoomAttributeDefinitions(attributes), [attributes]);
  const attributeRows = useMemo(() => buildRoomProfileFields(room, attributeDefinitions), [attributeDefinitions, room]);
  const selectedField = attributeRows.find((row) => row.key === selectedFieldKey) ?? attributeRows[0];
  const sourceOptions = useMemo(() => ['All sources', ...Array.from(new Set(attributeRows.map((row) => row.sourceSystem))).sort()], [attributeRows]);
  const visibleRows = useMemo(() => {
    const search = fieldSearch.trim().toLowerCase();
    return attributeRows
      .filter((row) => row.tab === selectedTab || selectedTab === 'History')
      .filter((row) => sourceFilter === 'All sources' || row.sourceSystem === sourceFilter)
      .filter((row) => !requiredOnly || row.required)
      .filter((row) => !recentOnly || isRecentDate(row.updatedAt))
      .filter((row) => !emptyOnly || !row.value.trim())
      .filter((row) => !search || [row.label, row.value, row.description, row.sourceSystem, row.group].join(' ').toLowerCase().includes(search));
  }, [attributeRows, emptyOnly, fieldSearch, recentOnly, requiredOnly, selectedTab, sourceFilter]);
  const groupedAttributeEntries = useMemo(() => visibleRows.reduce<[string, RoomProfileFieldRow[]][]>((groups, row) => {
    const existing = groups.find(([group]) => group === row.group);
    if (existing) existing[1].push(row);
    else groups.push([row.group, [row]]);
    return groups;
  }, []), [visibleRows]);
  const statusBadges = [room.isArchived ? 'Archived' : 'Active', room.isTeaching ? 'Timetabled' : '', room.isBookable ? 'Bookable' : ''].filter(Boolean);
  const visibleGroupNames = useMemo(() => groupedAttributeEntries.map(([group]) => group), [groupedAttributeEntries]);

  useEffect(() => {
    if (attributeRows.length && !attributeRows.some((row) => row.key === selectedFieldKey)) setSelectedFieldKey(attributeRows[0].key);
  }, [attributeRows, selectedFieldKey]);

  useEffect(() => {
    setEditingKey('');
    setEditingValue('');
    setIsDetailOpen(false);
  }, [room.id]);

  useEffect(() => {
    setExpandedGroups(new Set(visibleGroupNames));
  }, [selectedTab, visibleGroupNames]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };
  const setAllGroupsExpanded = (isExpanded: boolean) => {
    setExpandedGroups(isExpanded ? new Set(visibleGroupNames) : new Set());
  };
  const selectField = (fieldKey: string) => {
    setSelectedFieldKey(fieldKey);
    setIsDetailOpen(true);
  };
  const startEdit = (field: RoomProfileFieldRow) => {
    if (!requireAuthenticatedEdit('edit room profile fields')) return;
    setSelectedFieldKey(field.key);
    setEditingKey(field.key);
    setEditingValue(field.value);
    setIsDetailOpen(true);
  };
  const cancelEdit = () => {
    setEditingKey('');
    setEditingValue('');
  };
  const saveField = (field: RoomProfileFieldRow) => {
    if (!requireAuthenticatedEdit('save room profile field changes')) return;
    const nextValue = coerceEditedAttributeValue(editingValue, field.type, field.rawValue);
    const nextRoom: Room = {
      ...room,
      roomCode: field.key === 'room_code' && typeof nextValue === 'string' ? nextValue : room.roomCode,
      name: (field.key === 'room_name' || field.key === finalRoomNameAttributeKey) && typeof nextValue === 'string' ? nextValue : room.name,
      campus: field.key === 'campus' && typeof nextValue === 'string' ? nextValue : room.campus,
      building: field.key === 'building' && typeof nextValue === 'string' ? nextValue : room.building,
      floor: field.key === 'floor' && typeof nextValue === 'string' ? nextValue : room.floor,
      type: field.key === 'room_type' && typeof nextValue === 'string' ? nextValue : room.type,
      owner: field.key === 'assigned_department' && typeof nextValue === 'string' ? nextValue : room.owner,
      capacity: (field.key === 'capacity' || roomCapacityAttributeKeys.includes(field.key)) ? Number(nextValue) || room.capacity : room.capacity,
      attributes: {
        ...room.attributes,
        [field.key]: nextValue,
        ...((field.key === 'room_name' || field.key === finalRoomNameAttributeKey) && typeof nextValue === 'string' ? { [finalRoomNameAttributeKey]: nextValue } : {}),
      },
      qualityFlags: [...new Set([...room.qualityFlags, 'Unsaved admin edits'])],
    };
    setRooms(rooms.map((item) => (item.id === room.id ? nextRoom : item)));
    setEditingKey('');
    setEditingValue('');
    setToast(`${field.label} updated.`);
  };
  const copyFieldValue = async (field: RoomProfileFieldRow) => {
    try {
      await navigator.clipboard.writeText(field.value);
      setToast('Copied');
    } catch {
      setToast('Could not copy value');
    }
  };

  return (
    <>
      <PageHeader
        title="Room Profile"
        description={`${room.roomCode} / ${getRoomFinalName(room) || room.name || 'Unnamed room'}`}
        action={<button className="btn-primary" onClick={() => openRoomAdmin(room.id)}><Pencil size={16} /> Edit in Room Admin</button>}
      />
      <section className="space-y-5">
        <div className="panel rounded-lg p-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                <span>Room Search</span>
                <ChevronRight size={15} />
                <span>{room.roomCode}</span>
              </div>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">{getRoomFinalName(room) || room.name || room.roomCode}</h2>
              <p className="mt-1 text-sm text-slate-600">{room.owner || 'Unknown department'} / {room.category || 'No sub department provided'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {statusBadges.map((status) => <StatusBadge key={status} status={status} />)}
                {getActiveRoomQualityFlags(room).map((flag) => <span key={flag} className="badge border-amber-200 bg-amber-50 text-amber-700">{flag}</span>)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:min-w-[620px]">
              <Fact label="Capacity" value={getRoomCapacityDisplay(room, attributes)} />
              <Fact label="Floor" value={room.floor} />
              <Fact label="Building" value={room.building} />
              <Fact label="Campus" value={room.campus} />
              <Fact label="Room ID" value={room.roomCode} />
            </div>
          </div>
        </div>

        <div className="panel rounded-lg">
          <div className="border-b border-slate-200 px-4 pt-4">
            <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Room profile sections">
              {roomProfileTabs.map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={selectedTab === tab}
                  className={cn('whitespace-nowrap border-b-2 px-3 pb-3 text-sm font-bold transition', selectedTab === tab ? 'border-ecu-teal text-ecu-black' : 'border-transparent text-slate-500 hover:text-slate-900')}
                  onClick={() => setSelectedTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 border-slate-200 xl:border-r">
              <div className="space-y-3 border-b border-slate-200 p-4">
                <label className="relative block">
                  <span className="sr-only">Search room profile fields</span>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input className="input pl-9" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Search label, value, description or source" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input max-w-xs" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter by source system">
                    {sourceOptions.map((source) => <option key={source}>{source}</option>)}
                  </select>
                  <Toggle label="Required" checked={requiredOnly} onChange={setRequiredOnly} />
                  <Toggle label="Recently changed" checked={recentOnly} onChange={setRecentOnly} />
                  <Toggle label="Empty fields" checked={emptyOnly} onChange={setEmptyOnly} />
                  <button className="btn-secondary" onClick={() => setAllGroupsExpanded(true)}>Expand all</button>
                  <button className="btn-secondary" onClick={() => setAllGroupsExpanded(false)}>Collapse all</button>
                </div>
              </div>
              <div className="space-y-2 p-4">
                {groupedAttributeEntries.length ? groupedAttributeEntries.map(([group, rows]) => {
                  const isExpanded = expandedGroups.has(group);
                  return (
                    <section key={group} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                      <button className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-3 text-left" onClick={() => toggleGroup(group)} aria-expanded={isExpanded}>
                        <span className="flex min-w-0 items-center gap-2">
                          <ChevronDown size={16} className={cn('shrink-0 text-slate-500 transition-transform', !isExpanded && '-rotate-90')} />
                          <span className="truncate text-sm font-bold uppercase text-slate-800">{group}</span>
                        </span>
                        <span className="badge border-slate-200 bg-white text-slate-600">{rows.length} fields</span>
                      </button>
                      {isExpanded && (
                        group === coreRoomProfileGroup ? (
                          <CoreRoomProfileCards rows={rows} />
                        ) : (
                        <div className="divide-y divide-slate-200">
                          {rows.map((row) => (
                            <div key={row.key} className={cn('grid gap-3 px-3 py-3 text-sm transition md:grid-cols-[1.1fr_1fr_1.2fr_130px] md:items-center', selectedField?.key === row.key && 'bg-ecu-mint/70')}>
                              <button className="min-w-0 text-left" onClick={() => selectField(row.key)}>
                                <span className="block font-bold text-slate-950">{row.label}</span>
                                <span className="mt-1 block text-xs text-slate-500">{row.required ? 'Required' : 'Optional'} / {row.type}</span>
                              </button>
                              <div className="min-w-0 font-semibold text-slate-800">{editingKey === row.key ? <input className="input" value={editingValue} onChange={(event) => setEditingValue(event.target.value)} aria-label={`Edit ${row.label}`} /> : <span className="break-words">{row.value || 'Empty'}</span>}</div>
                              <div className="min-w-0">
                                <p className="text-slate-600">{row.description || 'No description provided'}</p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">{row.sourceSystem}</p>
                              </div>
                              <div className="flex justify-start gap-1 md:justify-end">
                                {editingKey === row.key ? (
                                  <>
                                    <button className="btn-primary px-2 py-1" onClick={() => saveField(row)}>Save</button>
                                    <button className="btn-secondary px-2 py-1" onClick={cancelEdit}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <button className="btn-secondary px-2 py-1" onClick={() => copyFieldValue(row)} aria-label={`Copy ${row.label}`}><Copy size={15} /></button>
                                    <button className="btn-secondary px-2 py-1" onClick={() => startEdit(row)} aria-label={`Edit ${row.label}`}><Pencil size={15} /></button>
                                    <button className="btn-secondary px-2 py-1" onClick={() => selectField(row.key)} aria-label={`View history for ${row.label}`}><History size={15} /></button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        )
                      )}
                    </section>
                  );
                }) : <p className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-600">No fields match the current filters.</p>}
              </div>
              {selectedTab === 'History' && (
                <div className="border-t border-slate-200 p-4">
                  <h3 className="font-bold text-slate-950">Downstream System Mappings</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">System</th>
                          <th className="px-3 py-2">External ID</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Last verified</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {roomMappings.map((mapping) => (
                          <tr key={mapping.systemName}>
                            <td className="px-3 py-2 font-semibold text-slate-900">{mapping.systemName}</td>
                            <td className="px-3 py-2 text-slate-600">{mapping.externalId}</td>
                            <td className="px-3 py-2"><StatusBadge status={mapping.status} /></td>
                            <td className="px-3 py-2 text-slate-600">{mapping.lastVerified}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-5 border-slate-200 bg-slate-50 p-4 xl:border-l">
              <div className="panel rounded-lg">
                <SectionTitle icon={ImageIcon} title="Floorplan" />
                <div className="p-4">
                  <FloorplanPreview imageUrl={room.floorplanImageUrl} roomName={roomDisplayName(room)} />
                </div>
              </div>
              <div className="panel rounded-lg p-4">
                <h3 className="font-bold text-slate-950">Capabilities</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {room.capabilities.map((capability) => <span key={capability} className="badge border-slate-200 bg-slate-50 text-slate-700">{capability}</span>)}
                </div>
              </div>
              <RoomProfileDetailPanel
                field={selectedField}
                isOpen={isDetailOpen}
                editingKey={editingKey}
                editingValue={editingValue}
                setEditingValue={setEditingValue}
                startEdit={startEdit}
                saveField={saveField}
                cancelEdit={cancelEdit}
                close={() => setIsDetailOpen(false)}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <TwoColumnPanel
            leftTitle="Physical Room Information"
            rightTitle="Booking and Access Information"
            left={<p className="text-sm leading-6 text-slate-700">{room.physicalNotes || 'No physical notes recorded.'}</p>}
            right={<p className="text-sm leading-6 text-slate-700">{room.bookingNotes || 'No booking notes recorded.'}</p>}
          />
          <div className="space-y-5">
            <div className="panel rounded-lg p-4">
              <h3 className="font-bold text-slate-950">Data Quality</h3>
              <div className="mt-3 space-y-2">
                {getActiveRoomQualityFlags(room).length ? getActiveRoomQualityFlags(room).map((flag) => (
                  <div key={flag} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{flag}</div>
                )) : <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">No known data conflicts.</div>}
              </div>
            </div>
          </div>
        </div>
        {toast && <div className="fixed bottom-4 right-4 z-40 rounded-md bg-ecu-black px-4 py-2 text-sm font-semibold text-white shadow-panel" role="status">{toast}</div>}
      </section>
    </>
  );
}

function RoomProfileDetailPanel({
  field,
  isOpen,
  editingKey,
  editingValue,
  setEditingValue,
  startEdit,
  saveField,
  cancelEdit,
  close,
}: {
  field?: RoomProfileFieldRow;
  isOpen: boolean;
  editingKey: string;
  editingValue: string;
  setEditingValue: (value: string) => void;
  startEdit: (field: RoomProfileFieldRow) => void;
  saveField: (field: RoomProfileFieldRow) => void;
  cancelEdit: () => void;
  close: () => void;
}) {
  if (!field) return null;

  return (
    <aside className={cn(
      'bg-white xl:block',
      isOpen ? 'fixed inset-x-0 bottom-0 z-30 max-h-[86vh] overflow-auto rounded-t-lg border-t border-slate-200 shadow-panel xl:static xl:max-h-none xl:rounded-none xl:border-t-0 xl:shadow-none' : 'hidden',
    )}>
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">Selected field</p>
            <h3 className="mt-1 text-lg font-bold text-slate-950">{field.label}</h3>
          </div>
          <button className="btn-secondary px-2 py-1 xl:hidden" onClick={close} aria-label="Close field detail panel">Close</button>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <p className="label">Current value</p>
          {editingKey === field.key ? (
            <div className="mt-2 space-y-2">
              <input className="input" value={editingValue} onChange={(event) => setEditingValue(event.target.value)} aria-label={`Edit ${field.label}`} />
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => saveField(field)}>Save</button>
                <button className="btn-secondary" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <p className="mt-1 break-words font-bold text-slate-900">{field.value || 'Empty'}</p>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <FieldDetailTerm label="Data type" value={field.type} />
          <FieldDetailTerm label="Group" value={field.group} />
          <FieldDetailTerm label="Source system" value={field.sourceSystem} />
          <FieldDetailTerm label="Required" value={field.required ? 'Yes' : 'No'} />
          <FieldDetailTerm label="Last updated" value={formatFieldTimestamp(field.updatedAt)} />
          <FieldDetailTerm label="Updated by" value="System" />
        </dl>
        <div>
          <p className="label">Description</p>
          <p className="mt-1 text-sm leading-6 text-slate-700">{field.description || 'No description provided'}</p>
        </div>
        <button className="btn-primary w-full" onClick={() => startEdit(field)}><Pencil size={16} /> Edit field</button>
        <div className="border-t border-slate-200 pt-4">
          <h4 className="font-bold text-slate-950">Field History</h4>
          <div className="mt-3 space-y-3">
            {buildFieldHistoryItems(field).map((item) => (
              <div key={item.title} className="border-l-2 border-ecu-teal pl-3 text-sm">
                <p className="font-semibold text-slate-900">{item.title}</p>
                <p className="text-slate-600">{item.actor}</p>
                <p className="mt-1 text-slate-700">{item.detail}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{item.source}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function CoreRoomProfileCards({ rows }: { rows: RoomProfileFieldRow[] }) {
  return (
    <div className="grid gap-3 bg-slate-50/50 p-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map((row) => {
        const Icon = coreRoomProfileIcon(row.key);
        return (
          <div
            key={row.key}
            className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ecu-mint text-ecu-black">
                <Icon size={18} />
              </span>
              <span className="min-w-0">
                <span className="label block">{row.label}</span>
                <span className="mt-1 block break-words text-base font-bold text-slate-950">{row.value || 'Empty'}</span>
                <span className="mt-2 block text-xs leading-5 text-slate-500">{row.description || 'No description provided'}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function coreRoomProfileIcon(key: string) {
  if (key === 'capacity') return Users;
  if (key === 'building') return Building2;
  if (key === 'campus') return Home;
  if (key === 'room_code') return KeyRound;
  return Database;
}

function FieldDetailTerm({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-slate-800">{value || 'Unknown'}</dd>
    </div>
  );
}

function TwoColumnPanel({ leftTitle, rightTitle, left, right }: { leftTitle: string; rightTitle: string; left: ReactNode; right: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel rounded-lg p-4">
        <h3 className="font-bold text-slate-950">{leftTitle}</h3>
        <div className="mt-3">{left}</div>
      </div>
      <div className="panel rounded-lg p-4">
        <h3 className="font-bold text-slate-950">{rightTitle}</h3>
        <div className="mt-3">{right}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Home; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-200 p-4">
      <Icon size={18} className="text-ecu-teal" />
      <h3 className="font-bold text-slate-950">{title}</h3>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes('Approved') || status.includes('Mapped') || status.includes('Completed') || status.includes('Verified')
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status.includes('Review') || status.includes('Information') || status.includes('Progress') || status.includes('Pending')
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : status.includes('Rejected') || status.includes('Blocked') || status.includes('error')
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  return <span className={cn('badge', tone)}>{status}</span>;
}

function Admin({
  rooms,
  setRooms,
  attributes,
  setAttributes,
  campuses,
  buildings,
  patterns,
  initialRoomId,
  requireAuthenticatedEdit,
}: {
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  attributes: AttributeDefinition[];
  setAttributes: (attributes: AttributeDefinition[]) => void;
  campuses: Campus[];
  buildings: Building[];
  patterns: RoomPattern[];
  initialRoomId: string;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const initialRoom = rooms.find((item) => item.id === initialRoomId) ?? rooms[0];
  const [editingId, setEditingId] = useState(initialRoom.id);
  const room = rooms.find((item) => item.id === editingId) ?? rooms[0];
  const [draft, setDraft] = useState(() => roomDraftWithFinalName(room));
  const [newAttribute, setNewAttribute] = useState({ key: '', label: '', type: 'boolean', group: 'General' });
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(() => new Set([floorGroupLabel(room)]));
  const [selectedCampus, setSelectedCampus] = useState(() => initialRoom.campus && !initialRoom.campus.startsWith('Unmapped') ? initialRoom.campus : '');
  const [roomAdminSearch, setRoomAdminSearch] = useState('');
  const draftCampusRecord = campuses.find((item) => item.name === draft.campus);
  const campusOptions = useMemo(() => {
    const names = [
      ...campuses.map((item) => item.name),
      ...rooms.map((item) => item.campus),
    ].filter((name) => name && !name.startsWith('Unmapped'));

    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [campuses, rooms]);
  const buildingOptions = useMemo(() => {
    const campusScopedBuildings = draftCampusRecord
      ? buildings.filter((item) => item.campusCode === draftCampusRecord.code)
      : buildings;

    return campusScopedBuildings.map((item) => buildingDisplayName(item.code, item.campusCode, buildings));
  }, [buildings, draftCampusRecord]);
  const adminRooms = useMemo(() => {
    const searchTerm = roomAdminSearch.trim().toLowerCase();
    return rooms
      .filter((item) => item.campus === selectedCampus)
      .filter((item) => {
        if (!searchTerm) return true;
        return [item.roomCode, item.name, getRoomFinalName(item), roomDisplayName(item)]
          .join(' ')
          .toLowerCase()
          .includes(searchTerm);
      });
  }, [rooms, roomAdminSearch, selectedCampus]);
  const roomGroupsByFloor = useMemo(() => {
    const groups = new Map<string, Room[]>();
    adminRooms.forEach((item) => {
      const floor = floorGroupLabel(item);
      groups.set(floor, [...(groups.get(floor) ?? []), item]);
    });

    return Array.from(groups.entries())
      .map(([floor, floorRooms]) => ({
        floor,
        rooms: [...floorRooms].sort((a, b) => roomDisplayName(a).localeCompare(roomDisplayName(b), undefined, { numeric: true })),
      }))
      .sort((a, b) => {
        const sortDifference = floorSortValue(a.floor) - floorSortValue(b.floor);
        return sortDifference || floorDisplayName(a.floor).localeCompare(floorDisplayName(b.floor), undefined, { numeric: true });
      });
  }, [adminRooms]);
  const groupedAttributeDefinitions = useMemo(() => getGroupedRoomAttributeDefinitions(attributes), [attributes]);

  useEffect(() => {
    setExpandedFloors((current) => {
      const next = new Set(current);
      next.add(floorGroupLabel(room));
      return next;
    });
  }, [room]);

  useEffect(() => {
    if (!campusOptions.includes(selectedCampus)) setSelectedCampus(campusOptions[0] ?? '');
  }, [campusOptions, selectedCampus]);

  useEffect(() => {
    if (!adminRooms.length || adminRooms.some((item) => item.id === editingId)) return;
    const next = roomDraftWithFinalName(adminRooms[0]);
    setEditingId(adminRooms[0].id);
    setDraft(next);
  }, [adminRooms, editingId]);

  const selectRoom = (id: string) => {
    const next = rooms.find((item) => item.id === id) ?? rooms[0];
    setEditingId(id);
    setDraft(roomDraftWithFinalName(next));
  };

  const toggleFloor = (floor: string) => {
    setExpandedFloors((current) => {
      const next = new Set(current);
      if (next.has(floor)) next.delete(floor);
      else next.add(floor);
      return next;
    });
  };

  const saveRoom = async () => {
    if (!requireAuthenticatedEdit('save room admin changes')) return;
    const parsed = roomSchema.safeParse(draft);
    if (!parsed.success) {
      alert('Please complete room code, name, campus, building, capacity, owner, and pattern.');
      return;
    }
    const finalName = draft.name.trim();
    const savedDraft = {
      ...draft,
      name: finalName,
      attributes: {
        ...draft.attributes,
        [finalRoomNameAttributeKey]: finalName,
      },
      qualityFlags: draft.qualityFlags.filter((flag) => flag !== 'Unsaved admin edits'),
    };

    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('rooms')
        .update({ floorplan_image_url: savedDraft.floorplanImageUrl ?? null })
        .eq('id', savedDraft.id);

      if (error) {
        alert(`Room draft was not saved because the floorplan image could not be stored: ${error.message}`);
        return;
      }
    }

    setRooms(rooms.map((item) => (item.id === draft.id ? savedDraft : item)));
  };

  const addAttribute = () => {
    if (!requireAuthenticatedEdit('add room attributes')) return;
    if (!newAttribute.key || !newAttribute.label) return;
    const group = normalizeAttributeGroup(newAttribute.group);
    setAttributes([
      ...attributes,
      {
        key: newAttribute.key.trim().toLowerCase().replace(/\s+/g, '_'),
        label: newAttribute.label,
        type: newAttribute.type as AttributeDefinition['type'],
        group,
        required: false,
        visible: true,
        downstreamSystems: [],
      },
    ]);
    setNewAttribute({ key: '', label: '', type: 'boolean', group: 'General' });
  };

  const updateDraftAttribute = (attribute: AttributeDefinition, value: string | number | boolean | string[]) => {
    setDraft((current) => {
      const nextAttributes = {
        ...current.attributes,
        [attribute.key]: value,
      };
      const nextQualityFlags = [...new Set([...current.qualityFlags, 'Unsaved admin edits'])];

      if (attribute.key === finalRoomNameAttributeKey && typeof value === 'string') {
        return { ...current, name: value, attributes: nextAttributes, qualityFlags: nextQualityFlags };
      }

      return { ...current, attributes: nextAttributes, qualityFlags: nextQualityFlags };
    });
  };

  const updateDraftFloorplan = (floorplanImageUrl?: string) => {
    setDraft((current) => ({
      ...current,
      floorplanImageUrl,
      qualityFlags: [...new Set([...current.qualityFlags, 'Unsaved admin edits'])],
    }));
  };

  const handleFloorplanUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      updateDraftFloorplan(await readImageFileAsDataUrl(file));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not upload the floorplan image.');
    }
  };

  return (
    <>
      <PageHeader
        title="Admin Data Management"
        description="Authorised users can edit room records, manage structured attributes, archive rooms, and preserve a change log."
        action={<button className="btn-primary" onClick={saveRoom}><CheckCircle2 size={16} /> Save room draft</button>}
      />
      <section className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <div className="panel rounded-lg">
          <SectionTitle icon={Building2} title="Rooms" />
          <div className="border-b border-slate-200 p-3">
            <FilterSelect label="Campus" value={selectedCampus} setValue={setSelectedCampus} options={campusOptions} />
            <label className="mt-3 block">
              <span className="label">Find room</span>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  className="input pl-9"
                  value={roomAdminSearch}
                  onChange={(event) => setRoomAdminSearch(event.target.value)}
                  placeholder="Room ID or name"
                />
              </div>
            </label>
          </div>
          <div className="max-h-[680px] overflow-auto p-2">
            {roomGroupsByFloor.length === 0 && (
              <p className="p-3 text-sm text-slate-600">No rooms found for this campus.</p>
            )}
            {roomGroupsByFloor.map((group) => {
              const isExpanded = expandedFloors.has(group.floor);
              return (
                <section key={group.floor} className="mb-2">
                  <button
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-bold text-slate-800 hover:bg-slate-50"
                    onClick={() => toggleFloor(group.floor)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ChevronRight size={16} className={cn('shrink-0 text-slate-500 transition-transform', isExpanded && 'rotate-90')} />
                      <span className="truncate">{floorDisplayName(group.floor)}</span>
                    </span>
                    <span className="badge border-slate-200 bg-white text-slate-600">{group.rooms.length}</span>
                  </button>
                  {isExpanded && (
                    <div className="mt-1 space-y-1 border-l border-slate-200 pl-6">
                      {group.rooms.map((item) => (
                        <button key={item.id} onClick={() => selectRoom(item.id)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50', item.id === editingId && 'bg-ecu-mint text-ecu-black')}>
                          <p className="font-normal">{roomDisplayName(item)}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel rounded-lg p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Room code" value={draft.roomCode} onChange={(value) => setDraft({ ...draft, roomCode: value, qualityFlags: [...new Set([...draft.qualityFlags, 'Unsaved admin edits'])] })} />
              <TextInput
                label="Name"
                value={draft.name}
                onChange={(value) => setDraft({
                  ...draft,
                  name: value,
                  attributes: { ...draft.attributes, [finalRoomNameAttributeKey]: value },
                  qualityFlags: [...new Set([...draft.qualityFlags, 'Unsaved admin edits'])],
                })}
              />
              <FilterSelect
                label="Campus"
                value={draft.campus}
                setValue={(value) => {
                  const nextCampus = campuses.find((item) => item.name === value);
                  const nextBuildingOptions = buildings
                    .filter((item) => !nextCampus || item.campusCode === nextCampus.code)
                    .map((item) => buildingDisplayName(item.code, item.campusCode, buildings));
                  setDraft({
                    ...draft,
                    campus: value,
                    building: nextBuildingOptions.includes(draft.building) ? draft.building : '',
                    qualityFlags: [...new Set([...draft.qualityFlags, 'Unsaved admin edits'])],
                  });
                }}
                options={campusOptions}
              />
              <FilterSelect label="Building" value={draft.building} setValue={(value) => setDraft({ ...draft, building: value, qualityFlags: [...new Set([...draft.qualityFlags, 'Unsaved admin edits'])] })} options={buildingOptions} />
              <TextInput label="Floor" value={draft.floor} onChange={(value) => setDraft({ ...draft, floor: value })} />
              <TextInput label="Capacity" value={String(draft.capacity)} onChange={(value) => setDraft({ ...draft, capacity: Number(value) || 0 })} />
              <FilterSelect label="Pattern" value={draft.pattern} setValue={(value) => setDraft({ ...draft, pattern: value })} options={patterns.map((item) => item.name)} />
              <TextInput label="Owner" value={draft.owner} onChange={(value) => setDraft({ ...draft, owner: value })} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Textarea label="Physical notes" value={draft.physicalNotes} onChange={(value) => setDraft({ ...draft, physicalNotes: value })} />
              <Textarea label="Booking notes" value={draft.bookingNotes} onChange={(value) => setDraft({ ...draft, bookingNotes: value })} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Toggle label="Bookable" checked={draft.isBookable} onChange={(value) => setDraft({ ...draft, isBookable: value })} />
              <Toggle label="Student accessible" checked={draft.isStudentAccessible} onChange={(value) => setDraft({ ...draft, isStudentAccessible: value })} />
              <Toggle label="Staff only" checked={draft.isStaffOnly} onChange={(value) => setDraft({ ...draft, isStaffOnly: value })} />
              <Toggle label="Archived" checked={draft.isArchived} onChange={(value) => setDraft({ ...draft, isArchived: value })} icon={Archive} />
            </div>
            <div className="mt-4 rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="label">Floorplan image</p>
                  <p className="mt-1 text-sm text-slate-600">Upload a small PNG, JPG, or WebP for this room.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={16} />
                    Upload
                    <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleFloorplanUpload} />
                  </label>
                  {draft.floorplanImageUrl && (
                    <button className="btn-secondary" onClick={() => updateDraftFloorplan(undefined)}>
                      <Trash2 size={16} /> Remove
                    </button>
                  )}
                </div>
              </div>
              <FloorplanPreview imageUrl={draft.floorplanImageUrl} roomName={roomDisplayName(draft)} className="mt-3" />
            </div>
          </div>

          <div className="panel rounded-lg">
            <SectionTitle icon={KeyRound} title="Configurable Attributes" />
            <div className="space-y-5 p-4">
              {groupedAttributeDefinitions.map(([group, groupAttributes]) => (
                <section key={group}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold uppercase text-slate-700">{group}</h4>
                    <span className="badge border-slate-200 bg-slate-50 text-slate-600">{groupAttributes.length} fields</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {groupAttributes.map((attribute) => (
                      <AttributeEditor
                        key={attribute.key}
                        attribute={attribute}
                        value={draft.attributes[attribute.key]}
                        onChange={(value) => updateDraftAttribute(attribute, value)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="border-t border-slate-200 p-4">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_1fr_auto]">
                <input className="input" placeholder="attribute_key" value={newAttribute.key} onChange={(event) => setNewAttribute({ ...newAttribute, key: event.target.value })} />
                <input className="input" placeholder="Label" value={newAttribute.label} onChange={(event) => setNewAttribute({ ...newAttribute, label: event.target.value })} />
                <select className="input" value={newAttribute.type} onChange={(event) => setNewAttribute({ ...newAttribute, type: event.target.value })}>
                  {['text', 'boolean', 'number', 'date', 'select', 'multi-select', 'tag', 'url', 'system reference'].map((type) => <option key={type}>{type}</option>)}
                </select>
                <input className="input" placeholder="Group" value={newAttribute.group} onChange={(event) => setNewAttribute({ ...newAttribute, group: event.target.value })} />
                <button className="btn-primary" onClick={addAttribute}><Plus size={16} /> Add</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function DataFieldManagement({
  attributes,
  setAttributes,
  groups,
  setGroups,
  requireAuthenticatedEdit,
}: {
  attributes: AttributeDefinition[];
  setAttributes: (attributes: AttributeDefinition[]) => void;
  groups: AttributeGroup[];
  setGroups: (groups: AttributeGroup[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const allAttributes = useMemo(() => getRoomAttributeDefinitions(attributes), [attributes]);
  const groupOptions = useMemo(() => mergeAttributeGroups(groups, getAttributeGroupsFromDefinitions(allAttributes)), [allAttributes, groups]);
  const [selectedGroup, setSelectedGroup] = useState(() => groupOptions.find((group) => group.name === 'BOOKING DATA')?.name ?? groupOptions[0]?.name ?? '');
  const [newGroupName, setNewGroupName] = useState('');
  const [renameGroupName, setRenameGroupName] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([]);
  const [bulkMoveGroup, setBulkMoveGroup] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allAttributes.forEach((attribute) => counts.set(attribute.group, (counts.get(attribute.group) ?? 0) + 1));
    return counts;
  }, [allAttributes]);

  const selectedGroupFields = useMemo(
    () => allAttributes.filter((attribute) => attribute.group === selectedGroup),
    [allAttributes, selectedGroup],
  );
  const filteredFields = useMemo(() => {
    const search = fieldSearch.trim().toLowerCase();
    if (!search) return selectedGroupFields;
    return selectedGroupFields.filter((field) => [field.label, field.key, field.type, field.group].join(' ').toLowerCase().includes(search));
  }, [fieldSearch, selectedGroupFields]);
  const recentFieldCount = allAttributes.filter((field) => isRecentDate(field.updatedAt)).length;
  const unassignedFieldCount = allAttributes.filter((field) => normalizeAttributeGroup(field.group) === customImportFieldGroup).length;
  const selectedFields = allAttributes.filter((field) => selectedFieldKeys.includes(field.key));

  useEffect(() => {
    if (groupOptions.some((group) => group.name === selectedGroup)) return;
    setSelectedGroup(groupOptions.find((group) => group.name === 'BOOKING DATA')?.name ?? groupOptions[0]?.name ?? '');
  }, [groupOptions, selectedGroup]);

  useEffect(() => {
    setSelectedFieldKeys([]);
    setBulkMoveGroup('');
  }, [selectedGroup]);

  const showToast = (message: string) => {
    setToast(message);
    setError('');
  };

  const addGroup = async () => {
    if (!requireAuthenticatedEdit('create a data field group')) return;
    const name = normalizeAttributeGroup(newGroupName.trim());
    if (!name) return;
    setIsSaving(true);
    try {
      const savedGroup = await createAttributeGroup(name);
      setGroups(mergeAttributeGroups(groups, [savedGroup]));
      setSelectedGroup(savedGroup.name);
      setNewGroupName('');
      showToast(`${savedGroup.name} was added.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not add the group.');
    } finally {
      setIsSaving(false);
    }
  };

  const renameGroup = async () => {
    if (!requireAuthenticatedEdit('rename a data field group')) return;
    const nextName = normalizeAttributeGroup(renameGroupName.trim());
    if (!selectedGroup || !nextName || nextName === selectedGroup) return;
    setIsSaving(true);
    try {
      const fieldsToMove = allAttributes.filter((field) => field.group === selectedGroup);
      const savedGroup = await renameAttributeGroup(selectedGroup, nextName, fieldsToMove);
      const updatedFields = fieldsToMove.map((field) => ({ ...field, group: nextName, updatedAt: savedGroup.updatedAt ?? new Date().toISOString() }));
      setAttributes(mergeAttributeDefinitions(attributes, updatedFields));
      setGroups(mergeAttributeGroups(groups.filter((group) => group.name !== selectedGroup), [savedGroup]));
      setSelectedGroup(nextName);
      setRenameGroupName('');
      showToast(`${selectedGroup} was renamed to ${nextName}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not rename the group.');
    } finally {
      setIsSaving(false);
    }
  };

  const removeGroup = async (groupName: string) => {
    if (!requireAuthenticatedEdit('delete a data field group')) return;
    const fieldsInGroup = allAttributes.filter((field) => field.group === groupName);
    if (fieldsInGroup.length) {
      setError(`Move ${fieldsInGroup.length} field${fieldsInGroup.length === 1 ? '' : 's'} out of ${groupName} before deleting it.`);
      return;
    }
    if (!window.confirm(`Delete the empty data field group "${groupName}"?`)) return;
    setIsSaving(true);
    try {
      await deleteAttributeGroup(groupName, fieldsInGroup);
      const nextGroups = groups.filter((group) => group.name !== groupName);
      setGroups(nextGroups);
      if (selectedGroup === groupName) setSelectedGroup(nextGroups[0]?.name ?? '');
      showToast(`${groupName} was deleted.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not delete the group.');
    } finally {
      setIsSaving(false);
    }
  };

  const moveFields = async (fields: AttributeDefinition[], groupName: string) => {
    if (!fields.length || !groupName || fields.every((field) => field.group === groupName)) return;
    if (!requireAuthenticatedEdit('move data fields between groups')) return;
    setIsSaving(true);
    try {
      const updatedFields = await moveAttributeDefinitionsToGroup(fields, groupName);
      setAttributes(mergeAttributeDefinitions(attributes, updatedFields));
      setGroups(mergeAttributeGroups(groups, [{ name: groupName, updatedAt: new Date().toISOString() }]));
      setSelectedFieldKeys((current) => current.filter((key) => !fields.some((field) => field.key === key)));
      showToast(`${fields.length} field${fields.length === 1 ? '' : 's'} moved to ${groupName}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not move the selected fields.');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSelectedField = (fieldKey: string) => {
    setSelectedFieldKeys((current) => (
      current.includes(fieldKey) ? current.filter((key) => key !== fieldKey) : [...current, fieldKey]
    ));
  };

  const allFilteredSelected = filteredFields.length > 0 && filteredFields.every((field) => selectedFieldKeys.includes(field.key));
  const toggleAllFilteredFields = () => {
    setSelectedFieldKeys((current) => {
      const filteredKeys = filteredFields.map((field) => field.key);
      if (allFilteredSelected) return current.filter((key) => !filteredKeys.includes(key));
      return [...new Set([...current, ...filteredKeys])];
    });
  };

  return (
    <>
      <PageHeader
        title="Data Field Management"
        description="Manage room data fields and their groupings without editing individual room records."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={KeyRound} label="Total fields" value={allAttributes.length} detail="Dictionary and configured fields" />
        <MetricCard icon={Database} label="Total groups" value={groupOptions.length} detail="Available field groupings" />
        <MetricCard icon={AlertTriangle} label="Unassigned fields" value={unassignedFieldCount} detail="Fields in Custom fields" />
        <MetricCard icon={History} label="Recently updated" value={recentFieldCount} detail="Updated in the last 7 days" />
      </section>

      {(toast || error) && (
        <div className={cn('mt-5 rounded-md border px-4 py-3 text-sm', error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {error || toast}
        </div>
      )}

      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="panel rounded-lg">
          <SectionTitle icon={Layers3} title="Groups" />
          <div className="space-y-3 border-b border-slate-200 p-4">
            <label className="block">
              <span className="label">New group</span>
              <div className="mt-1 flex gap-2">
                <input className="input" value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Group name" />
                <button className="btn-primary shrink-0" disabled={isSaving || !newGroupName.trim()} onClick={addGroup}>
                  <Plus size={16} /> Add
                </button>
              </div>
            </label>
            <label className="block">
              <span className="label">Rename selected group</span>
              <div className="mt-1 flex gap-2">
                <input className="input" value={renameGroupName} onChange={(event) => setRenameGroupName(event.target.value)} placeholder={selectedGroup || 'Select a group'} />
                <button className="btn-secondary shrink-0" disabled={isSaving || !renameGroupName.trim() || !selectedGroup} onClick={renameGroup}>
                  <Pencil size={16} /> Rename
                </button>
              </div>
            </label>
          </div>
          <div className="max-h-[620px] space-y-2 overflow-auto p-3">
            {groupOptions.length ? groupOptions.map((group) => {
              const count = groupCounts.get(group.name) ?? 0;
              const isSelected = selectedGroup === group.name;
              return (
                <div key={group.name} className={cn('rounded-md border p-3', isSelected ? 'border-ecu-teal bg-ecu-mint' : 'border-slate-200 bg-white')}>
                  <button className="block w-full text-left" onClick={() => setSelectedGroup(group.name)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-950">{group.name}</p>
                        <p className="mt-1 text-sm text-slate-600">{count} field{count === 1 ? '' : 's'}</p>
                      </div>
                      <span className="badge border-slate-200 bg-white text-slate-600">{count}</span>
                    </div>
                  </button>
                  <button
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-red-700 disabled:text-slate-400"
                    disabled={isSaving || count > 0}
                    onClick={() => void removeGroup(group.name)}
                    title={count > 0 ? 'Move fields out before deleting this group' : 'Delete group'}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              );
            }) : (
              <div className="rounded-md border border-dashed border-slate-300 p-5 text-sm text-slate-600">No field groups found.</div>
            )}
          </div>
        </div>

        <div className="panel rounded-lg">
          <div className="flex flex-col gap-4 border-b border-slate-200 p-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-bold text-slate-950">{selectedGroup || 'Select a group'}</h3>
              <p className="mt-1 text-sm text-slate-600">{selectedGroupFields.length} field{selectedGroupFields.length === 1 ? '' : 's'} in this group.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_220px_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input className="input pl-10" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Search fields" />
              </div>
              <select className="input" value={bulkMoveGroup} onChange={(event) => setBulkMoveGroup(event.target.value)}>
                <option value="">Bulk move to...</option>
                {groupOptions.filter((group) => group.name !== selectedGroup).map((group) => (
                  <option key={group.name} value={group.name}>{group.name}</option>
                ))}
              </select>
              <button className="btn-primary" disabled={isSaving || !bulkMoveGroup || !selectedFields.length} onClick={() => void moveFields(selectedFields, bulkMoveGroup)}>
                <Upload size={16} /> Move {selectedFields.length || ''}
              </button>
            </div>
          </div>

          {isSaving && <LoadingPanelMessage label="Saving field management changes" />}
          {!isSaving && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input type="checkbox" className="h-4 w-4 accent-ecu-teal" checked={allFilteredSelected} onChange={toggleAllFilteredFields} />
                    </th>
                    <th className="px-4 py-3">Field</th>
                    <th className="px-4 py-3">Database key</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Current grouping</th>
                    <th className="px-4 py-3">Move field</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFields.map((field) => (
                    <tr key={field.key}>
                      <td className="px-4 py-3">
                        <input type="checkbox" className="h-4 w-4 accent-ecu-teal" checked={selectedFieldKeys.includes(field.key)} onChange={() => toggleSelectedField(field.key)} />
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-950">{field.label}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{field.key}</td>
                      <td className="px-4 py-3 text-slate-700">{field.type}</td>
                      <td className="px-4 py-3 text-slate-700">{field.group}</td>
                      <td className="px-4 py-3">
                        <select className="input h-9" value={field.group} onChange={(event) => void moveFields([field], event.target.value)}>
                          {groupOptions.map((group) => <option key={group.name} value={group.name}>{group.name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredFields.length && (
                <div className="p-8 text-center text-sm text-slate-600">
                  {fieldSearch ? 'No fields match the current search.' : 'This group has no fields yet. Move fields into it from another group.'}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function CampusManagement({
  rooms,
  setRooms,
  campuses,
  setCampuses,
  buildings,
  setBuildings,
  requireAuthenticatedEdit,
}: {
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  campuses: Campus[];
  setCampuses: (campuses: Campus[]) => void;
  buildings: Building[];
  setBuildings: (buildings: Building[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(false);
  const [autoDetectBuildingAndFloor, setAutoDetectBuildingAndFloor] = useState(true);
  const unmappedRooms = rooms.filter((room) => !room.campus || room.campus.startsWith('Unmapped'));
  const suggestedCampusCode = unmappedRooms[0]?.roomCode.split('.')[0] ?? '';
  const [roomPrefixFilter, setRoomPrefixFilter] = useState(suggestedCampusCode || 'CC');
  const roomsMatchingPrefix = rooms.filter((room) => {
    const prefix = roomPrefixFilter.trim().toUpperCase();
    if (!prefix) return showOnlyUnmapped ? (!room.campus || room.campus.startsWith('Unmapped')) : true;
    return room.roomCode.toUpperCase().startsWith(`${prefix}.`) || room.roomCode.toUpperCase().startsWith(prefix);
  });
  const candidateRooms = showOnlyUnmapped ? roomsMatchingPrefix.filter((room) => !room.campus || room.campus.startsWith('Unmapped')) : roomsMatchingPrefix;
  const [campusDraft, setCampusDraft] = useState<Campus>({ code: suggestedCampusCode, name: suggestedCampusCode ? `${suggestedCampusCode} Campus` : '', address: '' });
  const [buildingDraft, setBuildingDraft] = useState<Building>({ code: '', name: '', campusCode: suggestedCampusCode || campuses[0]?.code || '', owner: 'Campus Operations' });
  const [editingBuildingKey, setEditingBuildingKey] = useState<{ campusCode: string; code: string } | null>(null);
  const [selectedCampusCode, setSelectedCampusCode] = useState(suggestedCampusCode || campuses[0]?.code || '');
  const [expandedCampusCodes, setExpandedCampusCodes] = useState<string[]>(() => [suggestedCampusCode || campuses[0]?.code || ''].filter(Boolean));
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const selectedRoomIdSet = useMemo(() => new Set(selectedRoomIds), [selectedRoomIds]);
  const [mappingProgress, setMappingProgress] = useState<CampusMappingProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const selectedCampus = campuses.find((campus) => campus.code === selectedCampusCode);
  const roomsToMap = useMemo(() => rooms.filter((room) => selectedRoomIdSet.has(room.id)), [rooms, selectedRoomIdSet]);
  const isMappingRooms = Boolean(mappingProgress);
  const buildingsByCampus = useMemo(() => {
    return campuses.map((campus) => ({
      campus,
      buildings: buildings
        .filter((building) => building.campusCode === campus.code)
        .sort((a, b) => a.code.localeCompare(b.code)),
    }));
  }, [buildings, campuses]);

  const toggleCampusExpanded = (code: string) => {
    setExpandedCampusCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const selectCampusForEdit = (campus: Campus) => {
    setCampusDraft(campus);
    setSelectedCampusCode(campus.code);
    setBuildingDraft((current) => ({ ...current, campusCode: campus.code }));
    setExpandedCampusCodes((current) => current.includes(campus.code) ? current : [...current, campus.code]);
  };

  const selectBuildingForEdit = (building: Building) => {
    setBuildingDraft(building);
    setEditingBuildingKey({ campusCode: building.campusCode, code: building.code });
    setSelectedCampusCode(building.campusCode);
    setExpandedCampusCodes((current) => current.includes(building.campusCode) ? current : [...current, building.campusCode]);
    setStatusMessage(`Editing building ${building.code}.`);
    setErrorMessage('');
  };

  const startNewBuilding = (campusCode = selectedCampusCode || campuses[0]?.code || '') => {
    setBuildingDraft({ code: '', name: '', campusCode, owner: 'Campus Operations' });
    setEditingBuildingKey(null);
    setSelectedCampusCode(campusCode);
    if (campusCode) setExpandedCampusCodes((current) => current.includes(campusCode) ? current : [...current, campusCode]);
  };

  const saveCampus = async () => {
    if (!requireAuthenticatedEdit('save campus changes')) return;
    const code = campusDraft.code.trim().toUpperCase();
    const name = campusDraft.name.trim();
    if (!code || !name) {
      setErrorMessage('Campus code and name are required.');
      return;
    }
    const nextCampus = { ...campusDraft, code, name };
    try {
      const result = await persistCampusDetails(nextCampus);
      setCampuses(campuses.some((campus) => campus.code === code)
        ? campuses.map((campus) => campus.code === code ? nextCampus : campus)
        : [...campuses, nextCampus]);
      setSelectedCampusCode(code);
      setBuildingDraft({ ...buildingDraft, campusCode: code });
      setStatusMessage(result.action === 'supabase'
        ? `Campus ${code} saved to Supabase. You can now map imported rooms to it.`
        : `Campus ${code} saved in demo state. You can now map imported rooms to it.`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save campus.');
    }
  };

  const saveBuilding = async () => {
    if (!requireAuthenticatedEdit('save building changes')) return;
    const code = buildingDraft.code.trim();
    const name = buildingDraft.name.trim();
    if (!buildingDraft.campusCode || !code || !name) {
      setErrorMessage('Building campus, code, and name are required.');
      return;
    }
    const nextBuilding = { ...buildingDraft, code, name };
    const nextCampuses = campuses.some((campus) => campus.code === nextBuilding.campusCode) ? campuses : [...campuses, campusDraft];
    try {
      const result = await persistBuildingDetails(nextBuilding, nextCampuses);
      const changedBuildingKey = editingBuildingKey
        && (editingBuildingKey.campusCode !== nextBuilding.campusCode || editingBuildingKey.code !== nextBuilding.code);
      if (changedBuildingKey) {
        const previousBuilding = buildings.find((building) => building.campusCode === editingBuildingKey.campusCode && building.code === editingBuildingKey.code);
        if (previousBuilding) await persistBuildingRemoval(previousBuilding, campuses);
      }
      const buildingsWithoutPrevious = changedBuildingKey
        ? buildings.filter((building) => !(building.campusCode === editingBuildingKey.campusCode && building.code === editingBuildingKey.code))
        : buildings;
      setBuildings(buildingsWithoutPrevious.some((building) => building.campusCode === nextBuilding.campusCode && building.code === nextBuilding.code)
        ? buildingsWithoutPrevious.map((building) => building.campusCode === nextBuilding.campusCode && building.code === nextBuilding.code ? nextBuilding : building)
        : [...buildingsWithoutPrevious, nextBuilding]);
      setSelectedCampusCode(nextBuilding.campusCode);
      setExpandedCampusCodes((current) => current.includes(nextBuilding.campusCode) ? current : [...current, nextBuilding.campusCode]);
      setEditingBuildingKey({ campusCode: nextBuilding.campusCode, code: nextBuilding.code });
      setStatusMessage(result.action === 'supabase' ? `Building ${nextBuilding.code} saved to Supabase.` : `Building ${nextBuilding.code} saved in demo state.`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not save building.');
    }
  };

  const removeCampus = async (campus: Campus) => {
    if (!requireAuthenticatedEdit('remove campuses')) return;
    const campusBuildings = buildings.filter((building) => building.campusCode === campus.code);
    if (campusBuildings.length) {
      setErrorMessage(`Remove ${campusBuildings.length} building(s) from ${campus.code} before removing the campus.`);
      return;
    }

    try {
      const result = await persistCampusRemoval(campus);
      const nextCampuses = campuses.filter((item) => item.code !== campus.code);
      setCampuses(nextCampuses);
      if (selectedCampusCode === campus.code) {
        const nextCampusCode = nextCampuses[0]?.code ?? '';
        setSelectedCampusCode(nextCampusCode);
        setBuildingDraft({ code: '', name: '', campusCode: nextCampusCode, owner: 'Campus Operations' });
      }
      setExpandedCampusCodes((current) => current.filter((code) => code !== campus.code));
      setStatusMessage(result.action === 'supabase' ? `Campus ${campus.code} removed from active Supabase data.` : `Campus ${campus.code} removed from demo state.`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not remove campus.');
    }
  };

  const removeBuilding = async (building: Building) => {
    if (!requireAuthenticatedEdit('remove buildings')) return;
    try {
      const result = await persistBuildingRemoval(building, campuses);
      setBuildings(buildings.filter((item) => !(item.campusCode === building.campusCode && item.code === building.code)));
      if (buildingDraft.campusCode === building.campusCode && buildingDraft.code === building.code) {
        setBuildingDraft({ code: '', name: '', campusCode: building.campusCode, owner: 'Campus Operations' });
        setEditingBuildingKey(null);
      }
      setStatusMessage(result.action === 'supabase' ? `Building ${building.code} removed from active Supabase data.` : `Building ${building.code} removed from demo state.`);
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not remove building.');
    }
  };

  const toggleRoom = (roomId: string) => {
    setSelectedRoomIds((current) => current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId]);
  };

  const mapRooms = async () => {
    if (!requireAuthenticatedEdit('map room locations')) return;
    if (isMappingRooms) return;
    if (!selectedCampus || !roomsToMap.length) {
      setErrorMessage('Select a campus and at least one room to map.');
      return;
    }

    setErrorMessage('');
    setStatusMessage('');
    setMappingProgress({
      percent: 0,
      completed: 0,
      total: roomsToMap.length,
      message: 'Preparing room mapping',
    });
    try {
      const result = await persistCampusMapping({
        campus: selectedCampus,
        rooms: roomsToMap,
        autoDetectBuildingAndFloor,
        onProgress: setMappingProgress,
      });
      const inferredBuildings = autoDetectBuildingAndFloor
        ? roomsToMap.flatMap((room) => {
            const parsed = parseRoomCode(room.roomCode);
            if (!parsed) return [];
            return [{
              code: parsed.buildingCode,
              name: buildingDraft.code === parsed.buildingCode && buildingDraft.campusCode === selectedCampus.code
                ? buildingDraft.name
                : `Building ${parsed.buildingCode}`,
              campusCode: selectedCampus.code,
              owner: 'Campus Operations',
            }];
          })
        : [];
      if (inferredBuildings.length) {
        const nextBuildings = [...buildings];
        inferredBuildings.forEach((building) => {
          if (!nextBuildings.some((item) => item.campusCode === building.campusCode && item.code === building.code)) {
            nextBuildings.push(building);
          }
        });
        setBuildings(nextBuildings);
      }
      setRooms(rooms.map((room) => selectedRoomIdSet.has(room.id)
        ? mapRoomToCampusLocation(room, selectedCampus, buildings, autoDetectBuildingAndFloor)
        : room));
      setSelectedRoomIds([]);
      setStatusMessage(result.action === 'supabase'
        ? `${result.mapped} room(s) mapped and saved to Supabase.`
        : `${result.mapped} room(s) mapped in demo state.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not map rooms.');
    } finally {
      setMappingProgress(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Campus and Building Management"
        description="Create and edit campus/building reference data, then map imported rooms that arrived with missing or unmapped campus details."
      />
      {statusMessage && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{statusMessage}</div>}
      {errorMessage && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMessage}</div>}
      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Campus Details</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <TextInput label="Campus code" value={campusDraft.code} onChange={(value) => setCampusDraft({ ...campusDraft, code: value })} />
              <TextInput label="Campus name" value={campusDraft.name} onChange={(value) => setCampusDraft({ ...campusDraft, name: value })} />
              <div className="md:col-span-2">
                <TextInput label="Address" value={campusDraft.address ?? ''} onChange={(value) => setCampusDraft({ ...campusDraft, address: value })} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={saveCampus}><CheckCircle2 size={16} /> Save campus</button>
              {suggestedCampusCode && (
                <button className="btn-secondary" onClick={() => setCampusDraft({ code: suggestedCampusCode, name: `${suggestedCampusCode} Campus`, address: '' })}>
                  Use suggested code {suggestedCampusCode}
                </button>
              )}
            </div>
          </div>

          <div className="panel rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-slate-950">Building Details</h3>
              <button className="btn-secondary py-1 text-xs" onClick={() => startNewBuilding()}><Plus size={14} /> New building</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <FilterSelect label="Campus" value={buildingDraft.campusCode} setValue={(value) => setBuildingDraft({ ...buildingDraft, campusCode: value })} options={campuses.map((campus) => campus.code)} />
              <TextInput label="Building code" value={buildingDraft.code} onChange={(value) => setBuildingDraft({ ...buildingDraft, code: value })} />
              <TextInput label="Building name" value={buildingDraft.name} onChange={(value) => setBuildingDraft({ ...buildingDraft, name: value })} />
              <TextInput label="Owner" value={buildingDraft.owner} onChange={(value) => setBuildingDraft({ ...buildingDraft, owner: value })} />
            </div>
            <div className="mt-4">
              <button className="btn-primary" onClick={saveBuilding}><CheckCircle2 size={16} /> Save building</button>
            </div>
          </div>

          <div className="panel rounded-lg">
            <SectionTitle icon={Building2} title="Existing Campuses" />
            <div className="divide-y divide-slate-200">
              {buildingsByCampus.map(({ campus, buildings: campusBuildings }) => (
                <div key={campus.code}>
                  <div className="flex flex-col gap-3 p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                    <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => {
                      toggleCampusExpanded(campus.code);
                      selectCampusForEdit(campus);
                    }}>
                      <ChevronRight size={18} className={cn('mt-0.5 shrink-0 text-slate-500 transition-transform', expandedCampusCodes.includes(campus.code) && 'rotate-90')} />
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-950">{campus.code} - {campus.name}</span>
                        <span className="block text-sm text-slate-600">{campusBuildings.length} building(s)</span>
                      </span>
                    </button>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <button className="btn-secondary py-1 text-xs" onClick={() => selectCampusForEdit(campus)}><Pencil size={14} /> Edit campus</button>
                      <button className="btn-secondary py-1 text-xs" onClick={() => startNewBuilding(campus.code)}><Plus size={14} /> Add building</button>
                      <button
                        className="btn-secondary py-1 text-xs"
                        onClick={() => {
                          if (window.confirm(`Remove campus ${campus.code}?`)) void removeCampus(campus);
                        }}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </div>
                  {expandedCampusCodes.includes(campus.code) && (
                    <div className="border-t border-slate-100 bg-slate-50 py-3 pl-8 pr-4 sm:pl-12">
                      {campusBuildings.length ? (
                        <div className="grid gap-2 border-l border-slate-300 pl-4 sm:pl-5">
                          {campusBuildings.map((building) => (
                            <div key={`${building.campusCode}-${building.code}`} className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-950">{buildingDisplayName(building.code, building.campusCode, buildings)}</p>
                                <p className="text-sm text-slate-600">{building.owner || 'No owner recorded'}</p>
                              </div>
                              <div className="flex flex-wrap gap-2 sm:justify-end">
                                <button className="btn-secondary py-1 text-xs" onClick={() => selectBuildingForEdit(building)}><Pencil size={14} /> Edit</button>
                                <button
                                  className="btn-secondary py-1 text-xs"
                                  onClick={() => {
                                    if (window.confirm(`Remove building ${buildingDisplayName(building.code, building.campusCode, buildings)}?`)) void removeBuilding(building);
                                  }}
                                >
                                  <Trash2 size={14} /> Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="ml-4 rounded-md border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600 sm:ml-5">
                          No buildings recorded for this campus yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Map Imported Rooms</h3>
            <p className="mt-1 text-sm text-slate-600">Find imported rooms by room-code prefix and assign them to a governed campus.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <TextInput label="Room code prefix" value={roomPrefixFilter} onChange={setRoomPrefixFilter} />
              <FilterSelect label="Target campus" value={selectedCampusCode} setValue={setSelectedCampusCode} options={campuses.map((campus) => campus.code)} />
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                Building and floor are detected from room IDs like CC.1N.245A.
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Toggle label="Only unmapped campus" checked={showOnlyUnmapped} onChange={setShowOnlyUnmapped} />
              <Toggle label="Auto-detect building/floor from room ID" checked={autoDetectBuildingAndFloor} onChange={setAutoDetectBuildingAndFloor} />
              <button className="btn-secondary" disabled={isMappingRooms} onClick={() => setSelectedRoomIds(candidateRooms.map((room) => room.id))}>Select matching rooms</button>
              <button className="btn-secondary" disabled={isMappingRooms} onClick={() => setSelectedRoomIds([])}>Clear selection</button>
              <button className="btn-primary" disabled={isMappingRooms || !selectedRoomIds.length} onClick={mapRooms}>
                {isMappingRooms ? <span className="loading-spinner h-4 w-4" aria-hidden="true" /> : <CheckCircle2 size={16} />}
                {isMappingRooms ? 'Mapping rooms...' : 'Map selected rooms'}
              </button>
            </div>
            {mappingProgress && (
              <div className="mt-4 rounded-md border border-ecu-teal/30 bg-ecu-mint p-3" role="status" aria-live="polite">
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-3 font-semibold text-ecu-black">
                    <span className="loading-spinner" aria-hidden="true" />
                    {mappingProgress.message}
                  </div>
                  <span className="font-bold text-ecu-green">{mappingProgress.percent}% complete</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-ecu-teal transition-all" style={{ width: `${mappingProgress.percent}%` }} />
                </div>
                <p className="mt-2 text-xs font-medium text-slate-600">
                  {mappingProgress.completed} of {mappingProgress.total} selected room(s) processed
                </p>
              </div>
            )}
          </div>

          <div className="panel rounded-lg">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="font-bold text-slate-950">Unmapped Rooms</h3>
              <StatusBadge status={`${candidateRooms.length} matching`} />
            </div>
            <div className="max-h-[560px] divide-y divide-slate-200 overflow-auto">
              {candidateRooms.length ? candidateRooms.map((room) => (
                <label key={room.id} className="flex cursor-pointer items-start gap-3 p-4 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-ecu-teal"
                    checked={selectedRoomIdSet.has(room.id)}
                    disabled={isMappingRooms}
                    onChange={() => toggleRoom(room.id)}
                  />
                  <span>
                    <span className="block font-semibold text-slate-950">{roomDisplayName(room)}</span>
                    <span className="block text-sm text-slate-600">{room.campus} · {room.building} · {room.floor}</span>
                  </span>
                </label>
              )) : (
                <div className="p-4 text-sm text-slate-600">
                  No matching rooms are currently loaded. Try changing the prefix or click Reload data in the header.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function AttributeEditor({
  attribute,
  value,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: string | number | boolean | string[] | undefined;
  onChange: (value: string | number | boolean | string[]) => void;
}) {
  const textValue = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value ?? '');
  const options = attribute.options ?? [];

  const input = (() => {
    if (attribute.type === 'boolean') {
      return (
        <div className="mt-3">
          <Toggle label={value === true ? 'Yes' : 'No'} checked={value === true} onChange={onChange} />
        </div>
      );
    }

    if (attribute.type === 'number') {
      return (
        <input
          className="input mt-2"
          type="number"
          value={typeof value === 'number' ? value : textValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            const parsed = Number(nextValue);
            onChange(nextValue === '' || !Number.isFinite(parsed) ? nextValue : parsed);
          }}
        />
      );
    }

    if (attribute.type === 'date') {
      return (
        <input
          className="input mt-2"
          type="date"
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }

    if (attribute.type === 'select') {
      return (
        <select className="input mt-2" value={textValue} onChange={(event) => onChange(event.target.value)}>
          <option value="">Unspecified</option>
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
          {textValue && !options.includes(textValue) && <option value={textValue}>{textValue}</option>}
        </select>
      );
    }

    if (attribute.type === 'multi-select' || attribute.type === 'tag') {
      return (
        <textarea
          className="input mt-2 min-h-20"
          value={textValue}
          onChange={(event) => onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))}
        />
      );
    }

    return (
      <input
        className="input mt-2"
        type={attribute.type === 'url' ? 'url' : 'text'}
        value={textValue}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  })();

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="font-semibold text-slate-900">{attribute.label}</label>
          <p className="mt-1 text-sm text-slate-600">{attribute.type} - {attribute.group}</p>
        </div>
        {attribute.required && <span className="badge border-amber-200 bg-amber-50 text-amber-700">Required</span>}
      </div>
      {input}
      <p className="mt-2 text-xs text-slate-500">{attribute.downstreamSystems.join(', ') || 'No downstream mapping yet'}</p>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input mt-1" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea className="input mt-1 min-h-28" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Toggle({ label, checked, onChange, icon: Icon = CheckCircle2 }: { label: string; checked: boolean; onChange: (value: boolean) => void; icon?: typeof Home }) {
  return (
    <button onClick={() => onChange(!checked)} className={cn('btn-secondary', checked && 'border-ecu-teal bg-ecu-mint text-ecu-black')}>
      <Icon size={16} />
      {label}
    </button>
  );
}

function mapRoomToCampusLocation(room: Room, campus: Campus, buildings: Building[], autoDetectBuildingAndFloor: boolean): Room {
  const parsed = autoDetectBuildingAndFloor ? parseRoomCode(room.roomCode) : null;
  return {
    ...room,
    campus: campus.name,
    building: parsed ? buildingDisplayName(parsed.buildingCode, campus.code, buildings) : room.building,
    floor: parsed ? floorNameFromCode(parsed.floorCode) : room.floor,
    qualityFlags: [
      ...new Set(
        room.qualityFlags
          .filter((flag) => !flag.includes('Imported record pending validation'))
          .concat(parsed ? 'Campus, building, and floor mapped after import' : 'Campus mapped after import'),
      ),
    ],
  };
}

const emptyPatternDraft: RoomPattern = {
  id: '',
  name: '',
  category: categories[0]?.name ?? 'Teaching Space',
  description: '',
  ecuAvPatterns: [],
  vizcomAvPatterns: [],
  defaultBookingRules: [],
  defaultO365Config: [],
  timetablingEligible: false,
  accessLogic: [],
  requiredAttributes: [],
  approvalRequirements: ['System Owner'],
  downstreamSystems: ['O365'],
};

function Patterns({
  rooms,
  setRooms,
  patterns,
  setPatterns,
  requireAuthenticatedEdit,
}: {
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  patterns: RoomPattern[];
  setPatterns: (patterns: RoomPattern[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const [selectedPatternId, setSelectedPatternId] = useState(patterns[0]?.id ?? '');
  const selectedPattern = patterns.find((pattern) => pattern.id === selectedPatternId) ?? patterns[0] ?? emptyPatternDraft;
  const [draft, setDraft] = useState<RoomPattern>(selectedPattern);
  const [roomSearch, setRoomSearch] = useState('');
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [isEditingPatterns, setIsEditingPatterns] = useState(false);

  useEffect(() => {
    setDraft(selectedPattern);
    setSelectedRoomIds(new Set());
  }, [selectedPattern]);

  useEffect(() => {
    if (!patterns.some((pattern) => pattern.id === selectedPatternId)) {
      setSelectedPatternId(patterns[0]?.id ?? '');
    }
  }, [patterns, selectedPatternId]);

  const roomLinkRows = useMemo(() => {
    const search = roomSearch.trim().toLowerCase();
    return rooms
      .map((room) => {
        const avValues = getRoomAvPatternValues(room);
        return {
          room,
          avValues,
          isAliasMatch: roomMatchesPatternAliases(room, draft),
          isCurrentPattern: room.pattern === draft.name,
        };
      })
      .filter(({ room, avValues, isAliasMatch, isCurrentPattern }) => {
        if (!search) return true;
        return [room.roomCode, room.name, room.pattern, ...avValues]
          .join(' ')
          .toLowerCase()
          .includes(search)
          || isAliasMatch
          || isCurrentPattern;
      })
      .sort((a, b) => Number(b.isAliasMatch) - Number(a.isAliasMatch) || a.room.roomCode.localeCompare(b.room.roomCode, undefined, { numeric: true }));
  }, [draft, roomSearch, rooms]);

  const aliasMatchIds = useMemo(
    () => roomLinkRows.filter((row) => row.isAliasMatch).map((row) => row.room.id),
    [roomLinkRows],
  );
  const ecuAvPatternOptions = useMemo(() => getUniqueRoomAvPatternValues(rooms, 'ecu'), [rooms]);
  const vizcomAvPatternOptions = useMemo(() => getUniqueRoomAvPatternValues(rooms, 'vizcom'), [rooms]);
  const roomsUsingPattern = rooms.filter((room) => room.pattern === draft.name).length;

  const createPattern = () => {
    if (!requireAuthenticatedEdit('create room patterns')) return;
    const newPattern = {
      ...emptyPatternDraft,
      id: `pattern-${Date.now()}`,
      name: 'New Room Pattern',
      description: 'Describe when this governed pattern should be used.',
    };
    setPatterns([...patterns, newPattern]);
    setSelectedPatternId(newPattern.id);
  };

  const savePattern = () => {
    if (!requireAuthenticatedEdit('save room patterns')) return;
    const cleanedDraft = cleanPatternDraft(draft);
    if (!cleanedDraft.name.trim()) {
      alert('Pattern name is required.');
      return;
    }

    setPatterns(patterns.map((pattern) => (pattern.id === cleanedDraft.id ? cleanedDraft : pattern)));
    setRooms(rooms.map((room) => (room.pattern === selectedPattern.name ? applyPatternToRoom(room, cleanedDraft) : room)));
    setSelectedPatternId(cleanedDraft.id);
  };

  const deletePattern = () => {
    if (!requireAuthenticatedEdit('delete room patterns')) return;
    if (roomsUsingPattern > 0) {
      alert('Move rooms off this pattern before deleting it.');
      return;
    }
    const nextPatterns = patterns.filter((pattern) => pattern.id !== draft.id);
    setPatterns(nextPatterns);
    setSelectedPatternId(nextPatterns[0]?.id ?? '');
  };

  const selectAliasMatches = () => {
    setSelectedRoomIds(new Set(aliasMatchIds));
  };

  const toggleRoomSelection = (roomId: string, checked: boolean) => {
    setSelectedRoomIds((current) => {
      const next = new Set(current);
      if (checked) next.add(roomId);
      else next.delete(roomId);
      return next;
    });
  };

  const applyPatternToSelectedRooms = () => {
    if (!requireAuthenticatedEdit('apply room patterns')) return;
    const selectedIds = selectedRoomIds;
    setRooms(rooms.map((room) => (selectedIds.has(room.id) ? applyPatternToRoom(room, draft) : room)));
    setSelectedRoomIds(new Set());
  };

  if (!isEditingPatterns) {
    return (
      <>
        <PageHeader
          title="Room Pattern Overview"
          description="Review governed room patterns, default booking rules, required attributes, and implementation cues before editing the Room Patterns and Categories library."
          action={<button className="btn-primary" onClick={() => setIsEditingPatterns(true)}><Pencil size={16} /> Edit patterns</button>}
        />
        <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {patterns.map((pattern) => (
            <PatternOverviewCard
              key={pattern.id}
              pattern={pattern}
              linkedRooms={rooms.filter((room) => room.pattern === pattern.name).length}
              onEdit={() => {
                setSelectedPatternId(pattern.id);
                setIsEditingPatterns(true);
              }}
            />
          ))}
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Room Patterns and Categories"
        description="Manage reusable room patterns, link ECU and Vizcom AV pattern names, and batch assign matching rooms for initial link up."
        action={(
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setIsEditingPatterns(false)}><ChevronRight size={16} className="rotate-180" /> Overview</button>
            <button className="btn-primary" onClick={createPattern}><Plus size={16} /> New pattern</button>
          </div>
        )}
      />
      <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="panel rounded-lg">
          <SectionTitle icon={Layers3} title="Pattern Library" />
          <div className="max-h-[760px] overflow-auto p-2">
            {patterns.map((pattern) => (
              <button
                key={pattern.id}
                onClick={() => setSelectedPatternId(pattern.id)}
                className={cn('mb-2 w-full rounded-md border p-3 text-left text-sm transition', pattern.id === draft.id ? 'border-ecu-teal bg-ecu-mint' : 'border-slate-200 bg-white hover:border-slate-300')}
              >
                <p className="label">{pattern.category}</p>
                <p className="mt-1 font-bold text-slate-950">{pattern.name}</p>
                <p className="mt-1 text-slate-600">{rooms.filter((room) => room.pattern === pattern.name).length} linked room(s)</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel rounded-lg p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="label">{draft.category}</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">{draft.name || 'Untitled pattern'}</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={draft.timetablingEligible ? 'Timetabling eligible' : 'Not timetabled'} />
                <StatusBadge status={`${roomsUsingPattern} linked room${roomsUsingPattern === 1 ? '' : 's'}`} />
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextInput label="Pattern name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
              <FilterSelect label="Category" value={draft.category} setValue={(value) => setDraft({ ...draft, category: value })} options={categories.map((category) => category.name)} />
            </div>
            <div className="mt-4">
              <Textarea label="Description" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <AliasPicker
                label="ECU AV Pattern aliases"
                value={draft.ecuAvPatterns}
                options={ecuAvPatternOptions}
                onChange={(value) => setDraft({ ...draft, ecuAvPatterns: value })}
              />
              <AliasPicker
                label="Vizcom AV Pattern aliases"
                value={draft.vizcomAvPatterns}
                options={vizcomAvPatternOptions}
                onChange={(value) => setDraft({ ...draft, vizcomAvPatterns: value })}
              />
              <ListTextarea label="Booking rules" value={draft.defaultBookingRules} onChange={(value) => setDraft({ ...draft, defaultBookingRules: value })} />
              <ListTextarea label="Access logic" value={draft.accessLogic} onChange={(value) => setDraft({ ...draft, accessLogic: value })} />
              <ListTextarea label="Required attributes" value={draft.requiredAttributes} onChange={(value) => setDraft({ ...draft, requiredAttributes: value })} />
              <ListTextarea label="Downstream systems" value={draft.downstreamSystems} onChange={(value) => setDraft({ ...draft, downstreamSystems: value })} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Toggle label="Timetabling eligible" checked={draft.timetablingEligible} onChange={(value) => setDraft({ ...draft, timetablingEligible: value })} />
              <button className="btn-primary" onClick={savePattern}><CheckCircle2 size={16} /> Save pattern</button>
              <button className="btn-secondary" onClick={deletePattern} disabled={!draft.id}><Trash2 size={16} /> Delete</button>
            </div>
          </div>

          <div className="panel rounded-lg">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="font-bold text-slate-950">Initial Link Up</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Match rooms by ECU AV Pattern or Vizcom AV Pattern aliases, then apply this governed pattern in bulk.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={selectAliasMatches} disabled={aliasMatchIds.length === 0}>
                  <ListChecks size={16} /> Select {aliasMatchIds.length} match{aliasMatchIds.length === 1 ? '' : 'es'}
                </button>
                <button className="btn-primary" onClick={applyPatternToSelectedRooms} disabled={selectedRoomIds.size === 0}>
                  <RefreshCcw size={16} /> Apply to {selectedRoomIds.size} room{selectedRoomIds.size === 1 ? '' : 's'}
                </button>
              </div>
            </div>
            <div className="border-b border-slate-200 p-4">
              <label className="block">
                <span className="label">Find rooms</span>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    className="input pl-9"
                    value={roomSearch}
                    onChange={(event) => setRoomSearch(event.target.value)}
                    placeholder="Room code, name, current pattern, or AV pattern"
                  />
                </div>
              </label>
            </div>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Select</th>
                    <th className="px-4 py-3">Room</th>
                    <th className="px-4 py-3">Current pattern</th>
                    <th className="px-4 py-3">AV pattern values</th>
                    <th className="px-4 py-3">Match</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {roomLinkRows.map(({ room, avValues, isAliasMatch, isCurrentPattern }) => (
                    <tr key={room.id} className={isAliasMatch ? 'bg-emerald-50/60' : undefined}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedRoomIds.has(room.id)}
                          onChange={(event) => toggleRoomSelection(room.id, event.target.checked)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">{room.roomCode}</p>
                        <p className="text-slate-600">{getRoomFinalName(room) || room.name}</p>
                      </td>
                      <td className="px-4 py-3">{room.pattern}</td>
                      <td className="px-4 py-3 text-slate-600">{avValues.join(', ') || 'No AV pattern value'}</td>
                      <td className="px-4 py-3">
                        {isAliasMatch ? <StatusBadge status="Alias match" /> : isCurrentPattern ? <StatusBadge status="Already linked" /> : <StatusBadge status="Manual" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PatternOverviewCard({
  pattern,
  linkedRooms,
  onEdit,
}: {
  pattern: RoomPattern;
  linkedRooms: number;
  onEdit: () => void;
}) {
  const implementationTemplate = [
    ...pattern.defaultO365Config,
    ...pattern.accessLogic,
    ...pattern.downstreamSystems.map((system) => `${system} update`),
  ].filter(Boolean);
  const visibleImplementationItems = uniqueStrings(implementationTemplate).slice(0, 5);

  return (
    <article className="panel flex min-h-[300px] flex-col rounded-lg p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label">{pattern.category}</p>
          <div className="mt-1 flex items-center gap-2">
            <Layers3 size={17} className="shrink-0 text-ecu-teal" />
            <h3 className="text-lg font-bold text-slate-950">{pattern.name}</h3>
          </div>
        </div>
        <StatusBadge status={`${linkedRooms} room${linkedRooms === 1 ? '' : 's'}`} />
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">{pattern.description}</p>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <PatternOverviewBlock title="Default booking rules">
            <PatternOverviewBullets items={pattern.defaultBookingRules} fallback={pattern.timetablingEligible ? 'Timetabling eligible' : 'Not timetabled by default'} />
          </PatternOverviewBlock>

          <PatternOverviewBlock title="Required attributes">
            <div className="flex flex-wrap gap-1.5">
              {pattern.requiredAttributes.length ? pattern.requiredAttributes.map((attribute) => (
                <span key={attribute} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {attribute}
                </span>
              )) : (
                <span className="text-slate-500">No required attributes set.</span>
              )}
            </div>
          </PatternOverviewBlock>
        </div>

        <PatternOverviewBlock title="Implementation template" className="h-full">
          <PatternOverviewBullets items={visibleImplementationItems} fallback="No implementation steps set." />
        </PatternOverviewBlock>
      </div>

      <div className="mt-auto flex justify-center pt-6">
        <button className="btn-secondary px-5 py-3" onClick={onEdit}>
          <Pencil size={16} /> Edit this pattern
        </button>
      </div>
    </article>
  );
}

function PatternOverviewBlock({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border border-slate-200 bg-white p-3', className)}>
      <h4 className="mb-2 font-bold text-slate-950">{title}</h4>
      {children}
    </section>
  );
}

function PatternOverviewBullets({ items, fallback }: { items: string[]; fallback: string }) {
  return items.length ? (
    <ul className="list-disc space-y-1 pl-4 text-slate-600">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  ) : (
    <p className="text-slate-500">{fallback}</p>
  );
}

function FloorplanPreview({ imageUrl, roomName, className }: { imageUrl?: string; roomName: string; className?: string }) {
  const [magnifierPosition, setMagnifierPosition] = useState({ x: 50, y: 50 });
  const [isMagnifying, setIsMagnifying] = useState(false);
  const [imageRatio, setImageRatio] = useState(1);

  if (!imageUrl) {
    return (
      <div className={cn('flex min-h-40 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-slate-500', className)}>
        No floorplan uploaded.
      </div>
    );
  }

  const updateMagnifierPosition = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100));
    setMagnifierPosition({ x, y });
  };

  return (
    <a
      href={imageUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open full-size floorplan for ${roomName}`}
      className={cn('floorplan-magnifier group block rounded-md border border-slate-200 bg-slate-50', className)}
      onMouseEnter={() => setIsMagnifying(true)}
      onMouseLeave={() => setIsMagnifying(false)}
      onMouseMove={updateMagnifierPosition}
      onFocus={() => setIsMagnifying(true)}
      onBlur={() => setIsMagnifying(false)}
    >
      <img
        src={imageUrl}
        alt={`Floorplan for ${roomName}`}
        className="max-h-72 w-full object-contain"
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth && naturalHeight) setImageRatio(naturalWidth / naturalHeight);
        }}
      />
      <span className="floorplan-magnifier__hint">
        <Search size={15} />
        Hover to magnify
      </span>
      <span
        className={cn('floorplan-magnifier__lens', isMagnifying && 'floorplan-magnifier__lens--visible')}
        style={{
          backgroundImage: `url("${imageUrl}")`,
          backgroundSize: imageRatio >= 1 ? `520% auto` : `auto 520%`,
          backgroundPosition: `${magnifierPosition.x}% ${magnifierPosition.y}%`,
          left: `${magnifierPosition.x}%`,
          top: `${magnifierPosition.y}%`,
        }}
        aria-hidden="true"
      />
    </a>
  );
}

function ListTextarea({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="input mt-1 min-h-28"
        value={value.join('\n')}
        onChange={(event) => onChange(splitListInput(event.target.value))}
      />
      <p className="mt-1 text-xs text-slate-500">One value per line, or separate values with commas.</p>
    </div>
  );
}

function AliasPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
}) {
  const selectedValues = uniqueStrings(value);
  const selectedKeys = new Set(selectedValues.map(normalizePatternValue));

  const toggleAlias = (alias: string) => {
    const aliasKey = normalizePatternValue(alias);
    if (selectedKeys.has(aliasKey)) {
      onChange(selectedValues.filter((item) => normalizePatternValue(item) !== aliasKey));
      return;
    }

    onChange(uniqueStrings([...selectedValues, alias]));
  };

  return (
    <div>
      <label className="label">{label}</label>
      <textarea
        className="input mt-1 min-h-24"
        value={selectedValues.join('\n')}
        onChange={(event) => onChange(splitListInput(event.target.value))}
      />
      <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="label">Current room data values</p>
        <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-auto">
          {options.length ? options.map((option) => {
            const isSelected = selectedKeys.has(normalizePatternValue(option));
            return (
            <button
              key={option}
              className={cn(
                'badge hover:border-ecu-teal hover:bg-ecu-mint',
                isSelected ? 'border-ecu-teal bg-ecu-mint text-ecu-black' : 'border-slate-200 bg-white text-slate-700',
              )}
              onClick={() => toggleAlias(option)}
              type="button"
            >
              {isSelected ? <CheckCircle2 size={13} /> : <Plus size={13} />} {option}
            </button>
          )}) : <p className="text-sm text-slate-500">No values found in current room data.</p>}
        </div>
      </div>
      {selectedValues.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedValues.map((alias) => (
            <button
              key={alias}
              className="badge border-ecu-teal bg-ecu-mint text-ecu-black hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              onClick={() => toggleAlias(alias)}
              type="button"
            >
              <Trash2 size={13} /> {alias}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function splitListInput(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanPatternDraft(pattern: RoomPattern): RoomPattern {
  return {
    ...pattern,
    name: pattern.name.trim(),
    category: pattern.category.trim(),
    description: pattern.description.trim(),
    ecuAvPatterns: uniqueStrings(pattern.ecuAvPatterns),
    vizcomAvPatterns: uniqueStrings(pattern.vizcomAvPatterns),
    defaultBookingRules: uniqueStrings(pattern.defaultBookingRules),
    defaultO365Config: uniqueStrings(pattern.defaultO365Config),
    accessLogic: uniqueStrings(pattern.accessLogic),
    requiredAttributes: uniqueStrings(pattern.requiredAttributes),
    downstreamSystems: uniqueStrings(pattern.downstreamSystems),
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function applyPatternToRoom(room: Room, pattern: RoomPattern): Room {
  const category = categories.find((item) => item.name === pattern.category);
  return {
    ...room,
    pattern: pattern.name,
    category: pattern.category,
    type: pattern.category,
    isTeaching: category?.isTeaching ?? room.isTeaching,
    isBookable: category?.isBookable ?? room.isBookable,
    isSpecialist: category?.isSpecialist ?? room.isSpecialist,
    downstreamSystems: pattern.downstreamSystems.length ? pattern.downstreamSystems : room.downstreamSystems,
    bookingNotes: room.bookingNotes || pattern.defaultBookingRules.join('; '),
    qualityFlags: [...new Set([...room.qualityFlags, 'Room pattern batch linked for review'])],
  };
}

function roomMatchesPatternAliases(room: Room, pattern: RoomPattern) {
  const roomValues = getRoomAvPatternValues(room).map(normalizePatternValue);
  const aliases = [...pattern.ecuAvPatterns, ...pattern.vizcomAvPatterns].map(normalizePatternValue);
  return roomValues.some((value) => aliases.includes(value));
}

function getRoomAvPatternValues(room: Room) {
  return getRoomAvPatternValuesForSource(room, 'all');
}

function getRoomAvPatternValuesForSource(room: Room, source: 'ecu' | 'vizcom' | 'all') {
  const patternKeyCandidates = new Set([
    'ecu_av_pattern',
    'vizcom_pattern',
    'vizcom_av_pattern',
  ]);

  return Object.entries(room.attributes)
    .filter(([key]) => {
      const normalizedKey = makeAttributeKey(key);
      const isEcuKey = normalizedKey.includes('ecu');
      const isVizcomKey = normalizedKey.includes('vizcom');
      if (source === 'ecu' && !isEcuKey) return false;
      if (source === 'vizcom' && !isVizcomKey) return false;
      return patternKeyCandidates.has(normalizedKey)
        || (normalizedKey.includes('pattern') && (normalizedKey.includes('ecu') || normalizedKey.includes('vizcom')));
    })
    .flatMap(([, value]) => Array.isArray(value) ? value.flatMap((item) => splitAliasValues(String(item))) : splitAliasValues(String(value)))
    .map((value) => value.trim())
    .filter(Boolean);
}

function getUniqueRoomAvPatternValues(rooms: Room[], source: 'ecu' | 'vizcom') {
  return uniqueStrings(rooms.flatMap((room) => getRoomAvPatternValuesForSource(room, source)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function splitAliasValues(value: string) {
  return value
    .split(/[\n;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePatternValue(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="label">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

type GovernanceRulesAdminTab = 'request-types' | 'rules' | 'templates' | 'systems';

function GovernanceRulesAdmin({
  requestTypes,
  setRequestTypes,
  systems,
  setSystems,
  rules,
  setRules,
  templates,
  setTemplates,
  requireAuthenticatedEdit,
  canManage,
}: {
  requestTypes: GovernanceRequestType[];
  setRequestTypes: (value: GovernanceRequestType[]) => void;
  systems: GovernanceSystem[];
  setSystems: (value: GovernanceSystem[]) => void;
  rules: GovernanceRule[];
  setRules: (value: GovernanceRule[]) => void;
  templates: GovernanceTemplate[];
  setTemplates: (value: GovernanceTemplate[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
  canManage: boolean;
}) {
  const [tab, setTab] = useState<GovernanceRulesAdminTab>('request-types');
  const [error, setError] = useState('');

  const tabs: { id: GovernanceRulesAdminTab; label: string }[] = [
    { id: 'request-types', label: 'Request Types' },
    { id: 'rules', label: 'Governance Rules' },
    { id: 'templates', label: 'Implementation Templates' },
    { id: 'systems', label: 'Downstream Systems' },
  ];

  return (
    <>
      <PageHeader
        title="Governance Rules Engine"
        description="Configure request types, approval rules, implementation templates, and downstream system integrations."
      />
      {error && <ErrorMessage message={error} onClose={() => setError('')} />}
      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition',
              tab === t.id
                ? 'border-ecu-teal text-ecu-teal'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'request-types' && (
        <GovernanceRequestTypesTab
          requestTypes={requestTypes}
          setRequestTypes={setRequestTypes}
          requireAuthenticatedEdit={requireAuthenticatedEdit}
          canManage={canManage}
          setError={setError}
        />
      )}
      {tab === 'rules' && (
        <GovernanceRulesTab
          rules={rules}
          setRules={setRules}
          requestTypes={requestTypes}
          systems={systems}
          requireAuthenticatedEdit={requireAuthenticatedEdit}
          canManage={canManage}
          setError={setError}
        />
      )}
      {tab === 'templates' && (
        <GovernanceTemplatesTab
          templates={templates}
          setTemplates={setTemplates}
          requestTypes={requestTypes}
          systems={systems}
          requireAuthenticatedEdit={requireAuthenticatedEdit}
          canManage={canManage}
          setError={setError}
        />
      )}
      {tab === 'systems' && (
        <GovernanceSystemsTab
          systems={systems}
          setSystems={setSystems}
          requireAuthenticatedEdit={requireAuthenticatedEdit}
          canManage={canManage}
          setError={setError}
        />
      )}
    </>
  );
}

const govRiskOptions = ['standard', 'high', 'critical'] as const;
const govRtCategories = ['Room Attributes', 'Booking Configuration', 'Lifecycle', 'Access', 'Integration', 'General'];

const riskBadge = (risk: 'standard' | 'high' | 'critical') => {
  if (risk === 'critical') return 'border-red-200 bg-red-50 text-red-700';
  if (risk === 'high') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

function blankRequestType(): Omit<GovernanceRequestType, 'id'> {
  return { name: '', description: '', category: 'General', riskLevel: 'standard', requiresRoom: true, sortOrder: 100, isActive: true };
}

function GovernanceRequestTypesTab({
  requestTypes,
  setRequestTypes,
  requireAuthenticatedEdit,
  canManage,
  setError,
}: {
  requestTypes: GovernanceRequestType[];
  setRequestTypes: (value: GovernanceRequestType[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
  canManage: boolean;
  setError: (msg: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<GovernanceRequestType, 'id'>>(blankRequestType);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    if (!requireAuthenticatedEdit('add request types')) return;
    setEditId(null);
    setForm(blankRequestType());
    setShowForm(true);
  };

  const openEdit = (rt: GovernanceRequestType) => {
    if (!requireAuthenticatedEdit('edit request types')) return;
    setEditId(rt.id);
    setForm({ name: rt.name, description: rt.description ?? '', category: rt.category, riskLevel: rt.riskLevel, requiresRoom: rt.requiresRoom, sortOrder: rt.sortOrder, isActive: rt.isActive });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.category.trim()) return;
    setSaving(true);
    try {
      const saved = await saveGovernanceRequestType({ ...(editId ? { id: editId } : {}), ...form, name: form.name.trim() });
      const updated: GovernanceRequestType = { id: editId ?? saved, ...form, name: form.name.trim() };
      setRequestTypes(editId ? requestTypes.map((r) => r.id === editId ? updated : r) : [...requestTypes, updated]);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save request type.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rt: GovernanceRequestType) => {
    if (!requireAuthenticatedEdit('delete request types')) return;
    if (!confirm(`Delete "${rt.name}"? Rules referencing it will be unlinked.`)) return;
    try {
      await deleteGovernanceRequestType(rt.id);
      setRequestTypes(requestTypes.filter((r) => r.id !== rt.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete request type.');
    }
  };

  const grouped = requestTypes.reduce<Record<string, GovernanceRequestType[]>>((acc, rt) => {
    (acc[rt.category] = acc[rt.category] ?? []).push(rt);
    return acc;
  }, {});

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={openNew}><Plus size={16} /> New request type</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-ecu-teal/30 bg-slate-50 p-5">
          <p className="mb-4 font-semibold text-slate-900">{editId ? 'Edit request type' : 'New request type'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Name <span className="text-red-500">*</span></label>
              <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Capacity Change" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input className="input mt-1" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this request type cover?" />
            </div>
            <div>
              <label className="label">Category <span className="text-red-500">*</span></label>
              <select className="input mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {govRtCategories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Risk level</label>
              <select className="input mt-1" value={form.riskLevel} onChange={(e) => setForm({ ...form, riskLevel: e.target.value as GovernanceRequestType['riskLevel'] })}>
                {govRiskOptions.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Sort order</label>
              <input className="input mt-1" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4" checked={form.requiresRoom} onChange={(e) => setForm({ ...form, requiresRoom: e.target.checked })} />
                Requires a room to be linked
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={!form.name.trim() || saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Create'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!requestTypes.length && !showForm && (
        <EmptyState icon={GitBranch} title="No request types configured" description={canManage ? 'Click "New request type" to add one, or run the governance seed migration.' : 'No request types have been configured yet.'} />
      )}

      <div className="grid gap-6">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">{category}</h3>
            <div className="grid gap-2">
              {items.map((rt) => (
                <div key={rt.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{rt.name}</p>
                    {rt.description && <p className="mt-0.5 text-sm text-slate-500">{rt.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('badge text-xs', riskBadge(rt.riskLevel))}>{rt.riskLevel.charAt(0).toUpperCase() + rt.riskLevel.slice(1)} risk</span>
                    {!rt.requiresRoom && <span className="badge border-slate-200 bg-slate-50 text-slate-600 text-xs">No room required</span>}
                    {canManage && (
                      <>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => openEdit(rt)}><Pencil size={13} /> Edit</button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50" onClick={() => void handleDelete(rt)}><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type DraftCondition = { attributeKey: string; operator: GovernanceRuleCondition['operator']; value: string };
type DraftAction = { actionType: GovernanceRuleAction['actionType']; target: string; label: string; riskLevel: string; reason: string };

function blankDraftAction(): DraftAction {
  return { actionType: 'require_approval', target: 'approver', label: '', riskLevel: 'high', reason: '' };
}

function GovernanceRulesTab({
  rules,
  setRules,
  requestTypes,
  systems,
  requireAuthenticatedEdit,
  canManage,
  setError,
}: {
  rules: GovernanceRule[];
  setRules: (value: GovernanceRule[]) => void;
  requestTypes: GovernanceRequestType[];
  systems: GovernanceSystem[];
  requireAuthenticatedEdit: (action?: string) => boolean;
  canManage: boolean;
  setError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleRtId, setRuleRtId] = useState('');
  const [ruleAppliesTo, setRuleAppliesTo] = useState<GovernanceRule['appliesTo']>('all');
  const [ruleRisk, setRuleRisk] = useState<GovernanceRule['riskLevel']>('standard');
  const [conditions, setConditions] = useState<DraftCondition[]>([]);
  const [actions, setActions] = useState<DraftAction[]>([blankDraftAction()]);

  const addCondition = () => setConditions([...conditions, { attributeKey: '', operator: 'equals', value: '' }]);
  const removeCondition = (i: number) => setConditions(conditions.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, patch: Partial<DraftCondition>) =>
    setConditions(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c));

  const addAction = () => setActions([...actions, blankDraftAction()]);
  const removeAction = (i: number) => setActions(actions.filter((_, idx) => idx !== i));
  const updateAction = (i: number, patch: Partial<DraftAction>) =>
    setActions(actions.map((a, idx) => idx === i ? { ...a, ...patch } : a));

  const resetForm = () => {
    setRuleName(''); setRuleDesc(''); setRuleRtId(''); setRuleAppliesTo('all'); setRuleRisk('standard');
    setConditions([]); setActions([blankDraftAction()]);
  };

  const openNew = () => {
    if (!requireAuthenticatedEdit('add governance rules')) return;
    resetForm();
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!ruleName.trim()) return;
    setSaving(true);
    try {
      const ruleId = await saveGovernanceRule({
        id: '',
        name: ruleName.trim(),
        description: ruleDesc.trim() || undefined,
        requestTypeId: ruleRtId || undefined,
        appliesTo: ruleAppliesTo,
        riskLevel: ruleRisk,
        isActive: true,
        sortOrder: (rules.length + 1) * 10,
      });

      const builtConditions = conditions.filter((c) => c.attributeKey.trim()).map((c, i) => ({
        attributeKey: c.attributeKey.trim(),
        operator: c.operator,
        value: c.value.trim() || undefined,
        sortOrder: i,
      }));
      const builtActions = actions.map((a, i) => {
        const params: Record<string, unknown> = {};
        if (a.actionType === 'require_approval') { params.label = a.label || a.target; params.stage = i + 1; }
        if (a.actionType === 'set_risk') params.risk_level = a.riskLevel;
        if (a.actionType === 'flag_for_review') params.reason = a.reason;
        return { actionType: a.actionType, target: a.target || undefined, parameters: params, sortOrder: i };
      });
      await saveRuleConditionsAndActions(ruleId, builtConditions, builtActions);

      const newRule: GovernanceRule = {
        id: ruleId,
        name: ruleName.trim(),
        description: ruleDesc.trim() || undefined,
        requestTypeId: ruleRtId || undefined,
        appliesTo: ruleAppliesTo,
        riskLevel: ruleRisk,
        isActive: true,
        sortOrder: (rules.length + 1) * 10,
        conditions: builtConditions.map((c, i) => ({ ...c, id: `${ruleId}-c${i}`, ruleId })),
        actions: builtActions.map((a, i) => ({ ...a, id: `${ruleId}-a${i}`, ruleId })),
      };
      setRules([...rules, newRule]);
      setShowForm(false);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save rule.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    if (!requireAuthenticatedEdit('delete governance rules')) return;
    if (!confirm('Delete this rule? This cannot be undone.')) return;
    setDeleting(ruleId);
    try {
      await deleteGovernanceRule(ruleId);
      setRules(rules.filter((r) => r.id !== ruleId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete rule.');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggle = async (rule: GovernanceRule) => {
    if (!requireAuthenticatedEdit('update governance rules')) return;
    const updated = { ...rule, isActive: !rule.isActive };
    try {
      await saveGovernanceRule(updated);
      setRules(rules.map((r) => r.id === rule.id ? updated : r));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update rule.');
    }
  };

  const getRtName = (id?: string) => requestTypes.find((rt) => rt.id === id)?.name ?? 'All request types';
  const getActionLabel = (action: GovernanceRule['actions'][0]) => {
    if (action.actionType === 'require_approval') return `Require approval: ${action.parameters.label ?? action.target}`;
    if (action.actionType === 'notify_system') return `Notify system: ${systems.find((s) => s.code === action.target)?.name ?? action.target}`;
    if (action.actionType === 'set_risk') return `Set risk: ${String(action.parameters.risk_level ?? '')}`;
    if (action.actionType === 'flag_for_review') return `Flag for review`;
    return action.actionType;
  };

  const condOperators: { value: GovernanceRuleCondition['operator']; label: string }[] = [
    { value: 'equals', label: 'equals' }, { value: 'not_equals', label: 'not equals' },
    { value: 'contains', label: 'contains' }, { value: 'is_set', label: 'is set' },
    { value: 'is_not_set', label: 'is not set' }, { value: 'greater_than', label: '>' },
    { value: 'less_than', label: '<' }, { value: 'in', label: 'in (comma list)' },
  ];
  const actionTypes: { value: GovernanceRuleAction['actionType']; label: string }[] = [
    { value: 'require_approval', label: 'Require approval' },
    { value: 'notify_system', label: 'Notify system' },
    { value: 'set_risk', label: 'Set risk level' },
    { value: 'flag_for_review', label: 'Flag for review' },
    { value: 'generate_template_tasks', label: 'Generate template tasks' },
  ];

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={openNew}><Plus size={16} /> New rule</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-ecu-teal/30 bg-slate-50 p-5">
          <p className="mb-4 font-semibold text-slate-900">New governance rule</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Rule name <span className="text-red-500">*</span></label>
              <input className="input mt-1" value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="e.g. Booking Change — Requires Approval" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input className="input mt-1" value={ruleDesc} onChange={(e) => setRuleDesc(e.target.value)} placeholder="When and why this rule fires" />
            </div>
            <div>
              <label className="label">Applies to</label>
              <select className="input mt-1" value={ruleAppliesTo} onChange={(e) => setRuleAppliesTo(e.target.value as GovernanceRule['appliesTo'])}>
                <option value="all">All requests</option>
                <option value="request_type">Specific request type</option>
              </select>
            </div>
            {ruleAppliesTo === 'request_type' && (
              <div>
                <label className="label">Request type</label>
                <select className="input mt-1" value={ruleRtId} onChange={(e) => setRuleRtId(e.target.value)}>
                  <option value="">— select —</option>
                  {requestTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Risk level</label>
              <select className="input mt-1" value={ruleRisk} onChange={(e) => setRuleRisk(e.target.value as GovernanceRule['riskLevel'])}>
                {govRiskOptions.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Conditions */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Conditions <span className="font-normal text-slate-400">(optional — leave empty to always fire)</span></p>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={addCondition}><Plus size={13} /> Add condition</button>
            </div>
            {conditions.map((cond, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                <input className="input" placeholder="Attribute key" value={cond.attributeKey} onChange={(e) => updateCondition(i, { attributeKey: e.target.value })} />
                <select className="input" value={cond.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as GovernanceRuleCondition['operator'] })}>
                  {condOperators.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                </select>
                {['is_set', 'is_not_set'].includes(cond.operator)
                  ? <span />
                  : <input className="input" placeholder="Value" value={cond.value} onChange={(e) => updateCondition(i, { value: e.target.value })} />
                }
                <button type="button" className="text-slate-400 hover:text-red-500" onClick={() => removeCondition(i)}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Actions <span className="text-red-500">*</span></p>
              <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={addAction}><Plus size={13} /> Add action</button>
            </div>
            {actions.map((act, i) => (
              <div key={i} className="mb-3 rounded-md border border-slate-200 bg-white p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="label text-xs">Action type</label>
                    <select className="input mt-0.5" value={act.actionType} onChange={(e) => updateAction(i, { actionType: e.target.value as GovernanceRuleAction['actionType'] })}>
                      {actionTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  {act.actionType === 'require_approval' && (
                    <>
                      <div>
                        <label className="label text-xs">Approver role</label>
                        <select className="input mt-0.5" value={act.target} onChange={(e) => updateAction(i, { target: e.target.value })}>
                          <option value="approver">Approver</option>
                          <option value="admin">Admin</option>
                          <option value="room_data_editor">Room Data Editor</option>
                          <option value="system_owner">System Owner</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="label text-xs">Label shown in workflow</label>
                        <input className="input mt-0.5" placeholder="e.g. AV & Venues Team Lead" value={act.label} onChange={(e) => updateAction(i, { label: e.target.value })} />
                      </div>
                    </>
                  )}
                  {act.actionType === 'notify_system' && (
                    <div>
                      <label className="label text-xs">System</label>
                      <select className="input mt-0.5" value={act.target} onChange={(e) => updateAction(i, { target: e.target.value })}>
                        <option value="">— select —</option>
                        {systems.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                  {act.actionType === 'set_risk' && (
                    <div>
                      <label className="label text-xs">Risk level</label>
                      <select className="input mt-0.5" value={act.riskLevel} onChange={(e) => updateAction(i, { riskLevel: e.target.value })}>
                        {govRiskOptions.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                      </select>
                    </div>
                  )}
                  {act.actionType === 'flag_for_review' && (
                    <div>
                      <label className="label text-xs">Reason (shown in preview)</label>
                      <input className="input mt-0.5" placeholder="e.g. Pattern changes affect all booking systems" value={act.reason} onChange={(e) => updateAction(i, { reason: e.target.value })} />
                    </div>
                  )}
                </div>
                {actions.length > 1 && (
                  <button type="button" className="mt-2 text-xs text-slate-400 hover:text-red-500" onClick={() => removeAction(i)}>Remove action</button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={!ruleName.trim() || saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : 'Create rule'}</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {!rules.length && !showForm && (
        <EmptyState icon={GitBranch} title="No governance rules configured" description={canManage ? 'Click "New rule" to create one, or run the governance seed migration.' : 'No rules have been configured yet.'} />
      )}

      <div className="grid gap-3">
        {rules.map((rule) => (
          <div key={rule.id} className={cn('rounded-lg border bg-white', rule.isActive ? 'border-slate-200' : 'border-slate-100 opacity-60')}>
            <div
              className="flex cursor-pointer flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              onClick={() => setExpanded(expanded === rule.id ? null : rule.id)}
            >
              <div className="flex flex-wrap items-center gap-2">
                {expanded === rule.id ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
                <p className="font-semibold text-slate-900">{rule.name}</p>
                <span className={cn('badge text-xs', riskBadge(rule.riskLevel))}>{rule.riskLevel}</span>
                {!rule.isActive && <span className="badge border-slate-200 bg-slate-100 text-slate-500 text-xs">Inactive</span>}
              </div>
              <div className="flex items-center gap-2 pl-6 sm:pl-0">
                <span className="text-xs text-slate-400">{getRtName(rule.requestTypeId)}</span>
                {canManage && (
                  <>
                    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); void handleToggle(rule); }}>
                      {rule.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); void handleDelete(rule.id); }} disabled={deleting === rule.id}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
            {expanded === rule.id && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                {rule.description && <p className="mb-3 text-sm text-slate-600">{rule.description}</p>}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="label mb-2">Conditions {rule.conditions.length === 0 && <span className="font-normal text-slate-400">(always fires)</span>}</p>
                    {rule.conditions.length > 0 ? (
                      <ul className="space-y-1 text-sm text-slate-700">
                        {rule.conditions.map((c) => (
                          <li key={c.id} className="flex items-center gap-1">
                            <span className="rounded bg-slate-100 px-1 font-mono text-xs">{c.attributeKey}</span>
                            <span className="text-slate-400">{c.operator.replace(/_/g, ' ')}</span>
                            {c.value && <span className="rounded bg-slate-100 px-1 font-mono text-xs">{c.value}</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-slate-400">No attribute conditions — fires for all matching request types.</p>
                    )}
                  </div>
                  <div>
                    <p className="label mb-2">Actions</p>
                    <ul className="space-y-1 text-sm text-slate-700">
                      {rule.actions.map((a) => (
                        <li key={a.id} className="flex items-center gap-2">
                          <span className="size-1.5 shrink-0 rounded-full bg-ecu-teal" />
                          {getActionLabel(a)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GovernanceTemplatesTab({
  templates,
  setTemplates,
  requestTypes,
  systems,
  requireAuthenticatedEdit,
  canManage,
  setError,
}: {
  templates: GovernanceTemplate[];
  setTemplates: (value: GovernanceTemplate[]) => void;
  requestTypes: GovernanceRequestType[];
  systems: GovernanceSystem[];
  requireAuthenticatedEdit: (action?: string) => boolean;
  canManage: boolean;
  setError: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [newTemplateRtId, setNewTemplateRtId] = useState('');
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [showNewTaskForm, setShowNewTaskForm] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskTeam, setNewTaskTeam] = useState('');
  const [newTaskDays, setNewTaskDays] = useState(2);
  const [newTaskInstructions, setNewTaskInstructions] = useState('');
  const [saving, setSaving] = useState(false);

  const getRtName = (id?: string) => requestTypes.find((rt) => rt.id === id)?.name;

  const handleCreateTemplate = async () => {
    if (!requireAuthenticatedEdit('create templates') || !newTemplateName.trim()) return;
    setCreatingTemplate(true);
    try {
      const id = await saveGovernanceTemplate({ id: '', name: newTemplateName.trim(), description: newTemplateDesc.trim() || undefined, requestTypeId: newTemplateRtId || undefined, isActive: true });
      setTemplates([...templates, { id, name: newTemplateName.trim(), description: newTemplateDesc.trim() || undefined, requestTypeId: newTemplateRtId || undefined, isActive: true, tasks: [] }]);
      setNewTemplateName(''); setNewTemplateDesc(''); setNewTemplateRtId(''); setShowNewTemplateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create template.');
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    if (!requireAuthenticatedEdit('delete templates')) return;
    if (!confirm(`Delete template "${templateName}" and all its tasks?`)) return;
    try {
      await deleteGovernanceTemplate(templateId);
      setTemplates(templates.filter((t) => t.id !== templateId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete template.');
    }
  };

  const handleAddTask = async (templateId: string) => {
    if (!requireAuthenticatedEdit('add template tasks')) return;
    if (!newTaskTitle.trim() || !newTaskTeam.trim()) return;
    setSaving(true);
    try {
      const template = templates.find((t) => t.id === templateId);
      const sortOrder = (template?.tasks.length ?? 0) * 10 + 10;
      const savedId = await saveTemplateTask({
        templateId,
        title: newTaskTitle.trim(),
        ownerTeam: newTaskTeam.trim(),
        estimatedDays: newTaskDays,
        instructions: newTaskInstructions.trim() || undefined,
        sortOrder,
      });
      setTemplates(templates.map((t) => t.id === templateId
        ? {
            ...t,
            tasks: [...t.tasks, {
              id: savedId,
              templateId,
              title: newTaskTitle.trim(),
              ownerTeam: newTaskTeam.trim(),
              estimatedDays: newTaskDays,
              instructions: newTaskInstructions.trim() || undefined,
              sortOrder,
            }],
          }
        : t));
      setNewTaskTitle('');
      setNewTaskTeam('');
      setNewTaskDays(2);
      setNewTaskInstructions('');
      setShowNewTaskForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save task.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTask = async (templateId: string, taskId: string) => {
    if (!requireAuthenticatedEdit('delete template tasks')) return;
    try {
      await deleteTemplateTask(taskId);
      setTemplates(templates.map((t) => t.id === templateId ? { ...t, tasks: t.tasks.filter((task) => task.id !== taskId) } : t));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete task.');
    }
  };

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={() => { if (requireAuthenticatedEdit('create templates')) setShowNewTemplateForm(true); }}><Plus size={16} /> New template</button>
        </div>
      )}
      {showNewTemplateForm && (
        <div className="mb-6 rounded-lg border border-ecu-teal/30 bg-slate-50 p-5">
          <p className="mb-4 font-semibold text-slate-900">New implementation template</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Template name <span className="text-red-500">*</span></label>
              <input className="input mt-1" value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="e.g. Booking Config Change — Standard" />
            </div>
            <div>
              <label className="label">Linked request type</label>
              <select className="input mt-1" value={newTemplateRtId} onChange={(e) => setNewTemplateRtId(e.target.value)}>
                <option value="">None (applies to all)</option>
                {requestTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input mt-1" value={newTemplateDesc} onChange={(e) => setNewTemplateDesc(e.target.value)} placeholder="Brief description" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={!newTemplateName.trim() || creatingTemplate} onClick={() => void handleCreateTemplate()}>{creatingTemplate ? 'Creating…' : 'Create template'}</button>
            <button type="button" className="btn-secondary" onClick={() => { setShowNewTemplateForm(false); setNewTemplateName(''); setNewTemplateDesc(''); setNewTemplateRtId(''); }}>Cancel</button>
          </div>
        </div>
      )}
      {!templates.length && !showNewTemplateForm && (
        <EmptyState icon={ListChecks} title="No implementation templates configured" description={canManage ? 'Click "New template" to create one, or run the governance seed migration.' : 'No templates have been configured yet.'} />
      )}
      <div className="grid gap-3">
      {templates.map((template) => (
        <div key={template.id} className="rounded-lg border border-slate-200 bg-white">
          <div
            className="flex cursor-pointer items-center justify-between gap-2 p-4"
            onClick={() => setExpanded(expanded === template.id ? null : template.id)}
          >
            <div className="flex items-center gap-2">
              {expanded === template.id ? <ChevronDown size={16} className="shrink-0 text-slate-400" /> : <ChevronRight size={16} className="shrink-0 text-slate-400" />}
              <div>
                <p className="font-semibold text-slate-900">{template.name}</p>
                {getRtName(template.requestTypeId) && <p className="text-xs text-slate-400">{getRtName(template.requestTypeId)}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">{template.tasks.length} task{template.tasks.length !== 1 ? 's' : ''}</span>
              {canManage && (
                <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); void handleDeleteTemplate(template.id, template.name); }}><Trash2 size={13} /></button>
              )}
            </div>
          </div>
          {expanded === template.id && (
            <div className="border-t border-slate-100 px-4 pb-4 pt-3">
              {template.description && <p className="mb-3 text-sm text-slate-600">{template.description}</p>}
              <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {template.tasks.map((task, idx) => (
                  <div key={task.id} className="flex items-start justify-between gap-3 p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ecu-mint text-xs font-bold text-ecu-black">{idx + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                        <p className="text-xs text-slate-500">{task.ownerTeam} · {task.estimatedDays}d</p>
                        {task.instructions && <p className="mt-1 text-xs leading-5 text-slate-600">{task.instructions}</p>}
                      </div>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        className="mt-0.5 shrink-0 text-slate-400 hover:text-red-500"
                        onClick={() => void handleDeleteTask(template.id, task.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {template.tasks.length === 0 && (
                  <p className="p-3 text-sm text-slate-400">No tasks yet. Add one below.</p>
                )}
              </div>
              {canManage && (
                <div className="mt-3">
                  {showNewTaskForm === template.id ? (
                    <div className="rounded-md border border-ecu-teal/20 bg-slate-50 p-3">
                      <p className="label mb-2">Add task</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          className="input col-span-2"
                          placeholder="Task title"
                          value={newTaskTitle}
                          onChange={(e) => setNewTaskTitle(e.target.value)}
                        />
                        <input
                          className="input"
                          placeholder="Owner team"
                          value={newTaskTeam}
                          onChange={(e) => setNewTaskTeam(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <input
                            className="input w-20"
                            type="number"
                            min={1}
                            value={newTaskDays}
                            onChange={(e) => setNewTaskDays(Math.max(1, Number(e.target.value)))}
                          />
                          <span className="text-sm text-slate-500">days</span>
                        </div>
                        <textarea
                          className="input col-span-2 h-20 resize-none"
                          placeholder="Instructions (optional)"
                          value={newTaskInstructions}
                          onChange={(e) => setNewTaskInstructions(e.target.value)}
                        />
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!newTaskTitle.trim() || !newTaskTeam.trim() || saving}
                          onClick={() => void handleAddTask(template.id)}
                        >
                          {saving ? 'Saving…' : 'Add task'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => { setShowNewTaskForm(null); setNewTaskTitle(''); setNewTaskTeam(''); setNewTaskInstructions(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => setShowNewTaskForm(template.id)}
                    >
                      <Plus size={15} /> Add task
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

const govSystemTypes = ['booking', 'timetabling', 'facilities', 'access', 'signage', 'asset', 'specialist', 'integration'];

function GovernanceSystemsTab({
  systems,
  setSystems,
  requireAuthenticatedEdit,
  canManage,
  setError,
}: {
  systems: GovernanceSystem[];
  setSystems: (value: GovernanceSystem[]) => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
  canManage: boolean;
  setError: (msg: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', ownerTeam: '', systemType: 'integration', isActive: true, sortOrder: 100 });
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    if (!requireAuthenticatedEdit('add systems')) return;
    setEditId(null);
    setForm({ code: '', name: '', description: '', ownerTeam: '', systemType: 'integration', isActive: true, sortOrder: (systems.length + 1) * 10 });
    setShowForm(true);
  };
  const openEdit = (s: GovernanceSystem) => {
    if (!requireAuthenticatedEdit('edit systems')) return;
    setEditId(s.id);
    setForm({ code: s.code, name: s.name, description: s.description ?? '', ownerTeam: s.ownerTeam, systemType: s.systemType, isActive: s.isActive, sortOrder: s.sortOrder });
    setShowForm(true);
  };
  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setSaving(true);
    try {
      const saved = await saveGovernanceSystem({ ...(editId ? { id: editId } : {}), ...form });
      const updated: GovernanceSystem = { id: editId ?? saved, ...form };
      setSystems(editId ? systems.map((s) => s.id === editId ? updated : s) : [...systems, updated]);
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save system.');
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = async (system: GovernanceSystem) => {
    if (!requireAuthenticatedEdit('delete systems')) return;
    if (!confirm(`Delete "${system.name}"?`)) return;
    try {
      await deleteGovernanceSystem(system.id);
      setSystems(systems.filter((s) => s.id !== system.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete system.');
    }
  };

  const typeColour = (type: string) => {
    const map: Record<string, string> = {
      booking: 'border-blue-200 bg-blue-50 text-blue-700',
      timetabling: 'border-violet-200 bg-violet-50 text-violet-700',
      facilities: 'border-amber-200 bg-amber-50 text-amber-700',
      access: 'border-red-200 bg-red-50 text-red-700',
      signage: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      asset: 'border-slate-200 bg-slate-50 text-slate-700',
      specialist: 'border-teal-200 bg-teal-50 text-teal-700',
    };
    return map[type] ?? 'border-slate-200 bg-slate-50 text-slate-600';
  };

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={openNew}><Plus size={16} /> New system</button>
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-lg border border-ecu-teal/30 bg-slate-50 p-5">
          <p className="mb-4 font-semibold text-slate-900">{editId ? 'Edit system' : 'New downstream system'}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Code <span className="text-red-500">*</span></label>
              <input className="input mt-1 font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. O365" disabled={!!editId} />
            </div>
            <div>
              <label className="label">Display name <span className="text-red-500">*</span></label>
              <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Microsoft 365 / Exchange" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Description</label>
              <input className="input mt-1" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does this system do?" />
            </div>
            <div>
              <label className="label">Owner team</label>
              <input className="input mt-1" value={form.ownerTeam} onChange={(e) => setForm({ ...form, ownerTeam: e.target.value })} placeholder="e.g. Digital Services" />
            </div>
            <div>
              <label className="label">System type</label>
              <select className="input mt-1" value={form.systemType} onChange={(e) => setForm({ ...form, systemType: e.target.value })}>
                {govSystemTypes.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary" disabled={!form.code.trim() || !form.name.trim() || saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Create'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {!systems.length && !showForm && (
        <EmptyState icon={Database} title="No downstream systems configured" description={canManage ? 'Click "New system" to add one, or run the governance seed migration.' : 'No systems have been configured yet.'} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {systems.map((system) => (
          <div key={system.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{system.name}</p>
                <p className="font-mono text-xs text-slate-400">{system.code}</p>
              </div>
              <span className={cn('badge text-xs', typeColour(system.systemType))}>{system.systemType}</span>
            </div>
            {system.description && <p className="mt-2 text-sm text-slate-500">{system.description}</p>}
            <p className="mt-2 text-xs text-slate-400">Owner: {system.ownerTeam}</p>
            {canManage && (
              <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => openEdit(system)}><Pencil size={13} /> Edit</button>
                <button type="button" className="btn-secondary px-2 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50" onClick={() => void handleDelete(system)}><Trash2 size={13} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Governance({
  requests,
  setRequests,
  rooms,
  requestTypes,
  rules,
  systems,
  templates,
  requireAuthenticatedEdit,
}: {
  requests: ChangeRequest[];
  setRequests: (requests: ChangeRequest[]) => void;
  rooms: Room[];
  requestTypes: GovernanceRequestType[];
  rules: GovernanceRule[];
  systems: GovernanceSystem[];
  templates: GovernanceTemplate[];
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  type GovernanceTab = 'requests' | 'preview';
  const [tab, setTab] = useState<GovernanceTab>('requests');

  // New change request form state
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [crTitle, setCrTitle] = useState('');
  const [crRequestTypeId, setCrRequestTypeId] = useState('');
  const [crReason, setCrReason] = useState('');
  const [crRoomQuery, setCrRoomQuery] = useState('');
  const [crRoomId, setCrRoomId] = useState('');
  const [crSaving, setCrSaving] = useState(false);
  const [crError, setCrError] = useState('');

  const crRoomMatches = crRoomQuery.trim().length >= 2
    ? rooms.filter((r) => {
        const q = crRoomQuery.toLowerCase();
        return r.roomCode.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const selectedCrRoom = rooms.find((r) => r.id === crRoomId);
  const selectedCrRequestType = requestTypes.find((rt) => rt.id === crRequestTypeId);

  const handleSaveRequest = async () => {
    if (!requireAuthenticatedEdit('submit change requests')) return;
    if (!crTitle.trim() || !crRequestTypeId) return;
    setCrSaving(true);
    setCrError('');
    try {
      const evalResult = evaluateGovernanceRules({ requestTypeId: crRequestTypeId }, rules);
      const newRequest: Omit<ChangeRequest, 'id'> = {
        title: crTitle.trim(),
        requestType: selectedCrRequestType?.name ?? '',
        roomId: crRoomId || undefined,
        reason: crReason.trim(),
        status: 'Submitted',
        requestedBy: 'Current User',
        impactedSystems: evalResult.impactedSystems,
        risk: evalResult.riskLevel === 'standard' ? 'standard' : 'high',
        approvers: evalResult.requiredApprovals.map((a) => ({ role: a.label as ChangeRequest['approvers'][0]['role'], decision: 'Pending' })),
        tasks: [],
        history: [`Submitted — ${new Date().toLocaleDateString()}`],
      };
      const savedId = await saveChangeRequest(newRequest);
      setRequests([...requests, { ...newRequest, id: savedId }]);
      setCrTitle(''); setCrRequestTypeId(''); setCrReason(''); setCrRoomId(''); setCrRoomQuery('');
      setShowNewRequest(false);
    } catch (err) {
      setCrError(err instanceof Error ? err.message : 'Could not save change request.');
    } finally {
      setCrSaving(false);
    }
  };

  // Rule preview state
  const [previewRequestTypeId, setPreviewRequestTypeId] = useState('');
  const [previewResult, setPreviewResult] = useState<RuleEvaluationResult | null>(null);

  const runPreview = () => {
    if (!previewRequestTypeId) return;
    const result = evaluateGovernanceRules(
      { requestTypeId: previewRequestTypeId },
      rules,
    );
    setPreviewResult(result);
  };

  const updateRequestStatus = (id: string, status: ChangeRequest['status']) => {
    if (!requireAuthenticatedEdit('update governance requests')) return;
    setRequests(requests.map((request) => {
      if (request.id !== id) return request;
      const generatedTasks = status === 'Approved' && request.tasks.length === 0
        ? generateTasks(request)
        : request.tasks;
      return {
        ...request,
        status: status === 'Approved' ? 'Ready for Implementation' : status,
        tasks: generatedTasks,
        history: [...request.history, `${status} by current user`],
      };
    }));
  };

  const completeTask = (requestId: string, taskId: string, status: TaskStatus) => {
    if (!requireAuthenticatedEdit('update implementation tasks')) return;
    setRequests(requests.map((request) => request.id === requestId
      ? { ...request, tasks: request.tasks.map((task) => task.id === taskId ? { ...task, status } : task), history: [...request.history, `Task ${taskId} set to ${status}`] }
      : request));
  };

  const getSystemName = (code: string) => systems.find((s) => s.code === code)?.name ?? code;

  return (
    <>
      <PageHeader title="Governance Workflow" description="Workflow engine for request intake, multi-stage approvals, generated operational action lists, manual completion, runbook references, and audit history." />

      <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {(['Under Review', 'Awaiting Information', 'Ready for Implementation', 'Implemented', 'Verified'] as ChangeRequest['status'][]).map((status) => (
          <MetricCard key={status} icon={ClipboardCheck} label={status} value={requests.filter((request) => request.status === status).length} detail="Governed change requests" />
        ))}
      </section>

      <div className="mb-6 flex gap-2 border-b border-slate-200">
        {([['requests', 'Change Requests'], ['preview', 'Rule Preview']] as [GovernanceTab, string][]).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition',
              tab === t ? 'border-ecu-teal text-ecu-teal' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'requests' && (
        <div className="grid gap-6">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => { if (requireAuthenticatedEdit('submit change requests')) setShowNewRequest(true); }}>
              <Plus size={16} /> New change request
            </button>
          </div>

          {showNewRequest && (
            <div className="rounded-lg border border-ecu-teal/30 bg-slate-50 p-5">
              <p className="mb-4 font-semibold text-slate-900">New change request</p>
              {crError && <ErrorMessage message={crError} onClose={() => setCrError('')} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label">Title <span className="text-red-500">*</span></label>
                  <input className="input mt-1" value={crTitle} onChange={(e) => setCrTitle(e.target.value)} placeholder="Brief summary of the change" />
                </div>
                <div>
                  <label className="label">Request type <span className="text-red-500">*</span></label>
                  <select className="input mt-1" value={crRequestTypeId} onChange={(e) => setCrRequestTypeId(e.target.value)}>
                    <option value="">— select —</option>
                    {requestTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Room {selectedCrRequestType?.requiresRoom === false ? '' : ''}</label>
                  <div className="relative mt-1">
                    {selectedCrRoom ? (
                      <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                        <span className="flex-1 text-slate-900">{roomDisplayName(selectedCrRoom)}</span>
                        <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => { setCrRoomId(''); setCrRoomQuery(''); }}>×</button>
                      </div>
                    ) : (
                      <input className="input" placeholder="Search room code or name…" value={crRoomQuery} onChange={(e) => { setCrRoomQuery(e.target.value); setCrRoomId(''); }} />
                    )}
                    {crRoomMatches.length > 0 && !crRoomId && (
                      <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                        {crRoomMatches.map((r) => (
                          <button key={r.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setCrRoomId(r.id); setCrRoomQuery(''); }}>
                            <span className="font-mono text-xs text-slate-400">{r.roomCode}</span>
                            <span className="text-slate-700">{getRoomFinalName(r)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Reason / justification</label>
                  <textarea className="input mt-1 h-24 resize-none" value={crReason} onChange={(e) => setCrReason(e.target.value)} placeholder="Why is this change needed?" />
                </div>
              </div>
              {crRequestTypeId && (
                <div className="mt-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
                  {(() => {
                    const preview = evaluateGovernanceRules({ requestTypeId: crRequestTypeId }, rules);
                    return (
                      <div className="flex flex-wrap gap-4">
                        <span className={cn('font-semibold', preview.riskLevel === 'critical' ? 'text-red-600' : preview.riskLevel === 'high' ? 'text-amber-600' : 'text-emerald-600')}>
                          {preview.riskLevel.charAt(0).toUpperCase() + preview.riskLevel.slice(1)} risk
                        </span>
                        {preview.requiredApprovals.length > 0 && (
                          <span className="text-slate-600">{preview.requiredApprovals.length} approval stage{preview.requiredApprovals.length !== 1 ? 's' : ''} required</span>
                        )}
                        {preview.impactedSystems.length > 0 && (
                          <span className="text-slate-600">Systems: {preview.impactedSystems.join(', ')}</span>
                        )}
                        {preview.matchedRules.length === 0 && (
                          <span className="text-slate-400">No governance rules matched — will proceed with no required approvals.</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button type="button" className="btn-primary" disabled={!crTitle.trim() || !crRequestTypeId || crSaving} onClick={() => void handleSaveRequest()}>
                  {crSaving ? 'Submitting…' : 'Submit request'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setShowNewRequest(false); setCrTitle(''); setCrRequestTypeId(''); setCrReason(''); setCrRoomId(''); setCrRoomQuery(''); }}>Cancel</button>
              </div>
            </div>
          )}

          {requests.length === 0 && !showNewRequest && (
            <EmptyState icon={ClipboardCheck} title="No change requests" description="Click 'New change request' to submit one through the governed workflow." />
          )}
          {requests.map((request) => {
            const room = rooms.find((item) => item.id === request.roomId);
            return (
              <div key={request.id} className="panel rounded-lg p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-950">{request.id} · {request.title}</h3>
                      <StatusBadge status={request.status} />
                      <StatusBadge status={request.risk === 'high' ? 'High risk' : 'Standard risk'} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{room ? roomDisplayName(room) : 'No room linked'} · {request.requestType}</p>
                    <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-700">{request.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary" onClick={() => updateRequestStatus(request.id, 'Approved')}><CheckCircle2 size={16} /> Approve</button>
                    <button className="btn-secondary" onClick={() => updateRequestStatus(request.id, 'Rejected')}><AlertTriangle size={16} /> Reject</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  <MiniList title="Impacted systems" items={request.impactedSystems.map(getSystemName)} />
                  <MiniList title="Approvals" items={request.approvers.map((approver) => `${approver.role}: ${approver.decision}${approver.comments ? ` - ${approver.comments}` : ''}`)} />
                  <MiniList title="Audit history" items={request.history} />
                </div>
                <div className="mt-4 rounded-md border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="font-semibold text-slate-900">Generated implementation checklist</p>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {request.tasks.length ? request.tasks.map((task) => (
                      <div key={task.id} className="grid gap-3 p-4 md:grid-cols-[1fr_160px_180px_160px] md:items-center">
                        <div>
                          <p className="font-semibold text-slate-900">{task.title}</p>
                          <p className="text-sm text-slate-600">{task.system} · {task.ownerTeam} · due {task.dueDate}</p>
                        </div>
                        <StatusBadge status={task.status} />
                        <select className="input" value={task.status} onChange={(event) => completeTask(request.id, task.id, event.target.value as TaskStatus)}>
                          {['Not Started', 'In Progress', 'Blocked', 'Completed', 'Verified'].map((status) => <option key={status}>{status}</option>)}
                        </select>
                        <span className="text-sm text-slate-500">{task.dependency ? `Depends on ${task.dependency}` : 'No dependency'}</span>
                      </div>
                    )) : <p className="p-4 text-sm text-slate-600">Tasks will generate after approval based on request type, room pattern, and impacted systems.</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'preview' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.5fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-4 font-semibold text-slate-900">Rule evaluation preview</h3>
            <p className="mb-3 text-sm text-slate-600">
              Select a request type to see which governance rules would fire and what approvals, systems, and templates they would generate.
            </p>
            <label className="block">
              <span className="label">Request type</span>
              <select className="input mt-1" value={previewRequestTypeId} onChange={(e) => { setPreviewRequestTypeId(e.target.value); setPreviewResult(null); }}>
                <option value="">Select a request type…</option>
                {requestTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary mt-4 w-full"
              disabled={!previewRequestTypeId}
              onClick={runPreview}
            >
              <GitBranch size={16} /> Evaluate rules
            </button>
            {rules.length === 0 && (
              <p className="mt-3 text-xs text-amber-600">No governance rules loaded. Run the seed migration or configure rules in the Rules admin page.</p>
            )}
          </div>

          <div>
            {previewResult ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
                  <div>
                    <p className="label">Risk level</p>
                    <p className={cn('mt-1 font-semibold', previewResult.riskLevel === 'critical' ? 'text-red-600' : previewResult.riskLevel === 'high' ? 'text-amber-600' : 'text-emerald-600')}>
                      {previewResult.riskLevel.charAt(0).toUpperCase() + previewResult.riskLevel.slice(1)}
                    </p>
                  </div>
                  <div>
                    <p className="label">Rules matched</p>
                    <p className="mt-1 font-semibold text-slate-900">{previewResult.matchedRules.length}</p>
                  </div>
                  {previewResult.flaggedForReview && (
                    <span className="badge border-amber-200 bg-amber-50 text-amber-700">Flagged for review</span>
                  )}
                </div>

                {previewResult.matchedRules.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="label mb-2">Matched rules</p>
                    <ul className="space-y-1">
                      {previewResult.matchedRules.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <span className="size-1.5 shrink-0 rounded-full bg-ecu-teal" />
                          {r.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {previewResult.requiredApprovals.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="label mb-2">Required approval stages</p>
                    <div className="flex flex-wrap gap-2">
                      {previewResult.requiredApprovals.map((a) => (
                        <div key={a.stage} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <span className="flex size-5 items-center justify-center rounded-full bg-ecu-teal text-xs font-bold text-white">{a.stage}</span>
                          {a.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewResult.impactedSystems.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="label mb-2">Impacted systems</p>
                    <div className="flex flex-wrap gap-2">
                      {previewResult.impactedSystems.map((code) => (
                        <div key={code} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-sm text-blue-700">
                          {getSystemName(code)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewResult.matchedRules.length === 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                    No governance rules match this request type. The request would proceed without required approvals.
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
                Select a request type and click "Evaluate rules" to see the governance preview.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function generateTasks(request: ChangeRequest) {
  return request.impactedSystems.map((system, index) => ({
    id: `${request.id}-task-${index + 1}`,
    title: `Update ${system} records`,
    system,
    ownerTeam: system === 'Security/access' ? 'Identity and Access' : system === 'O365' ? 'Digital Services' : 'System owner team',
    dueDate: '2026-05-28',
    status: 'Not Started' as TaskStatus,
    notes: 'Generated from governance workflow template.',
  }));
}

function RoomsNeedingAttention({
  rooms,
  openRoom,
  loading,
  limit = 5,
}: {
  rooms: Room[];
  openRoom: (id: string) => void;
  loading: boolean;
  limit?: number;
}) {
  const flaggedRooms = rooms.filter((room) => getActiveRoomQualityFlags(room).length);
  const visibleRooms = flaggedRooms.slice(0, limit);
  const flagSummary = Array.from(flaggedRooms.reduce((summary, room) => {
    getActiveRoomQualityFlags(room).forEach((flag) => summary.set(flag, (summary.get(flag) ?? 0) + 1));
    return summary;
  }, new Map<string, number>()))
    .sort(([, firstCount], [, secondCount]) => secondCount - firstCount)
    .slice(0, 3);

  return (
    <div className="panel rounded-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
        <h3 className="font-bold text-slate-950">Rooms Needing Attention</h3>
        {!loading && <span className="badge border-amber-200 bg-amber-50 text-amber-700">{flaggedRooms.length} flagged</span>}
      </div>
      {loading ? (
        <LoadingPanelMessage label="Loading room quality data" />
      ) : flaggedRooms.length === 0 ? (
        <p className="p-4 text-sm text-slate-600">No rooms are currently flagged for attention.</p>
      ) : (
        <>
          <div className="grid gap-2 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
            {flagSummary.map(([flag, count]) => (
              <div key={flag} className="rounded-md border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-900">{count} rooms</p>
                <p className="mt-1 text-xs text-slate-600">{flag}</p>
              </div>
            ))}
          </div>
          <div className="divide-y divide-slate-200">
            {visibleRooms.map((room) => {
              const flagDetails = getRoomFlagDetails(room);
              return (
                <button key={room.id} onClick={() => openRoom(room.id)} className="flex w-full items-start justify-between gap-4 p-4 text-left hover:bg-slate-50">
                  <div className="min-w-0 space-y-3">
                    <div>
                      <p className="font-semibold text-slate-950">{roomDisplayName(room)}</p>
                      <p className="mt-1 text-sm text-slate-600">{room.building} - {room.floor}</p>
                    </div>
                    <div className="space-y-2">
                      {flagDetails.map((detail) => (
                        <div key={detail.flag} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                          <p className="text-sm font-semibold text-amber-900">{detail.flag}</p>
                          <p className="mt-1 text-sm leading-5 text-amber-800">{detail.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 shrink-0 text-slate-400" size={18} />
                </button>
              );
            })}
          </div>
          {flaggedRooms.length > visibleRooms.length && (
            <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Showing {visibleRooms.length} of {flaggedRooms.length} flagged rooms. Use Room Search for the full list.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function getRoomFlagDetails(room: Room) {
  return getActiveRoomQualityFlags(room).map((flag) => ({
    flag,
    reason: describeRoomQualityFlag(room, flag),
  }));
}

function getActiveRoomQualityFlags(room: Room) {
  return room.qualityFlags.filter((flag) => !isResolvedLocationMappingFlag(flag));
}

function isResolvedLocationMappingFlag(flag: string) {
  const normalizedFlag = flag.toLowerCase();
  return normalizedFlag.includes('mapped after import')
    && (normalizedFlag.includes('campus') || normalizedFlag.includes('building') || normalizedFlag.includes('floor'));
}

function describeRoomQualityFlag(room: Room, flag: string) {
  const normalizedFlag = flag.toLowerCase();
  const impactedSystems = room.downstreamSystems.length ? room.downstreamSystems.join(', ') : 'no downstream systems';
  const bookingContext = `${room.bookingStatus}; ${room.isBookable ? 'bookable' : 'not bookable'}; ${room.isStudentAccessible ? 'student accessible' : 'staff or controlled access'}`;

  if (normalizedFlag.includes('appspace')) {
    return `This room is connected to Appspace but the dashboard has no confirmed Appspace verification. Check the room signage/panel record before relying on the downstream mapping.`;
  }

  if (normalizedFlag.includes('security') || normalizedFlag.includes('access group')) {
    const accessGroup = room.attributes.student_access_group;
    const accessGroupText = typeof accessGroup === 'string' && accessGroup.trim() ? ` Current access group: ${accessGroup}.` : ' No student access group is recorded.';
    return `Access settings need review because the room is ${room.isStudentAccessible ? 'student accessible' : 'restricted'} and maps to ${impactedSystems}.${accessGroupText}`;
  }

  if (normalizedFlag.includes('imported update')) {
    return `An import changed this existing room. Review the updated fields before they flow into governed systems: ${impactedSystems}.`;
  }

  if (normalizedFlag.includes('imported record')) {
    return `This room was created from imported source data and has not yet been validated against the room dictionary, location hierarchy, and downstream systems.`;
  }

  if (normalizedFlag.includes('campus') || normalizedFlag.includes('building') || normalizedFlag.includes('floor') || normalizedFlag.includes('mapped after import')) {
    return `The location was inferred during import. Confirm campus, building, and floor before using this room for reporting or system updates.`;
  }

  if (normalizedFlag.includes('unsaved admin')) {
    return `Room details were edited in the admin view and still need to be saved or reviewed before the flag can be cleared.`;
  }

  if (normalizedFlag.includes('missing')) {
    return `Required supporting data appears to be missing. Current room context: ${bookingContext}; downstream systems: ${impactedSystems}.`;
  }

  if (normalizedFlag.includes('review')) {
    return `This room is queued for manual review because its current settings may affect booking, access, or downstream integrations. Current room context: ${bookingContext}.`;
  }

  return `Flag recorded in data quality checks. Review the room details, source import values, and downstream mappings before clearing it. Current room context: ${bookingContext}; downstream systems: ${impactedSystems}.`;
}

function ChangeRequestList({ requests, compact = false, limit }: { requests: ChangeRequest[]; compact?: boolean; limit?: number }) {
  const visibleLimit = limit ?? (compact ? 3 : requests.length);
  const visibleRequests = requests.slice(0, visibleLimit);

  return (
    <div className="panel rounded-lg">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
        <h3 className="font-bold text-slate-950">Change Requests</h3>
        <span className="badge border-slate-200 bg-slate-50 text-slate-600">{requests.length} total</span>
      </div>
      <div className="divide-y divide-slate-200">
        {visibleRequests.map((request) => (
          <div key={request.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-950">{request.id} - {request.title}</p>
              <StatusBadge status={request.status} />
              <StatusBadge status={request.risk === 'high' ? 'High risk' : 'Standard risk'} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{request.impactedSystems.join(', ')}</p>
            {!compact && <p className="mt-2 text-sm leading-6 text-slate-700">{request.reason}</p>}
          </div>
        ))}
      </div>
      {requests.length > visibleRequests.length && (
        <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Showing {visibleRequests.length} of {requests.length} requests. Open Governance for the full workflow.
        </p>
      )}
    </div>
  );
}

function ImportWizard({
  rooms,
  setRooms,
  attributes,
  setAttributes,
  refreshRoomData,
  requireAuthenticatedEdit,
}: {
  rooms: Room[];
  setRooms: (rooms: Room[]) => void;
  attributes: AttributeDefinition[];
  setAttributes: (attributes: AttributeDefinition[]) => void;
  refreshRoomData: () => void;
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
  const [stage, setStage] = useState<ImportStage>('upload');
  const [filename, setFilename] = useState('room-import.csv');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [createdFields, setCreatedFields] = useState<AttributeDefinition[]>([]);
  const [committed, setCommitted] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [commitResult, setCommitResult] = useState<PersistImportResult | null>(null);
  const [commitProgress, setCommitProgress] = useState<PersistImportProgress | null>(null);
  const attributeFieldOptions = useMemo(() => {
    const byKey = new Map([...roomDataDictionaryDefinitions, ...attributes].map((attribute) => [attribute.key, attribute]));
    return Array.from(byKey.values()).sort((a, b) => compareRoomDataDictionaryGroups(a.group, b.group) || a.label.localeCompare(b.label));
  }, [attributes]);
  const mappedDictionaryDefinitions = useMemo(() => {
    const mappedKeys = new Set(Object.values(mapping).flatMap((destination) => destination.startsWith('attr:') ? [destination.slice(5)] : []));
    return attributeFieldOptions.filter((field) => mappedKeys.has(field.key));
  }, [attributeFieldOptions, mapping]);
  const mappedDynamicDefinitions = useMemo(
    () => getDynamicAttributeDefinitionsFromMapping(mapping, rows, attributes),
    [attributes, mapping, rows],
  );
  const importAttributeDefinitions = useMemo(
    () => mergeAttributeDefinitions(createdFields, mappedDynamicDefinitions, mappedDictionaryDefinitions),
    [createdFields, mappedDynamicDefinitions, mappedDictionaryDefinitions],
  );

  const preview = useMemo<ImportPreviewRow[]>(() => {
    return rows.map((row, index) => {
      const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
      const roomCode = roomCodeHeader ? row[roomCodeHeader] : '';
      const issues: string[] = [];
      if (!roomCode) issues.push('Missing room code mapping');
      if (roomCode && !/^[A-Z]{2}\./.test(roomCode)) issues.push('Invalid room code format');
      const duplicate = rooms.some((room) => room.roomCode === roomCode);
      const unknownMappings = Object.values(mapping).filter((destination) => destination === 'create_dynamic_attribute').length;
      const dictionaryMappings = Object.values(mapping).filter((destination) => destination.startsWith('attr:')).length;
      if (unknownMappings) issues.push(`${unknownMappings} dynamic field(s) to create`);
      if (dictionaryMappings) issues.push(`${dictionaryMappings} dictionary field(s) mapped`);
      return { id: index + 1, source: row, action: issues.some((issue) => issue.startsWith('Invalid') || issue.startsWith('Missing')) ? 'error' : duplicate ? 'update' : 'create', issues };
    });
  }, [rows, mapping, rooms]);

  const errorRows = preview.filter((row) => row.action === 'error');
  const previewRowsToShow = errorRows.length
    ? [...errorRows, ...preview.filter((row) => row.action !== 'error')].slice(0, 50)
    : preview.slice(0, 50);
  const rowsToCreate = preview.filter((row) => row.action === 'create').length;
  const rowsToUpdate = preview.filter((row) => row.action === 'update').length;
  const hasRoomCodeMapping = Object.values(mapping).includes('roomCode');
  const canApproveImport = preview.length > 0 && hasRoomCodeMapping && errorRows.length === 0;

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsedHeaders = result.meta.fields ?? [];
        setHeaders(parsedHeaders);
        setRows(result.data);
        setMapping(Object.fromEntries(parsedHeaders.map((header) => [header, suggestMapping(header, attributeFieldOptions)])));
        setCreatedFields([]);
        setCommitted(false);
        setCommitError('');
        setCommitResult(null);
        setCommitProgress(null);
        setStage('mapping');
      },
    });
  };

  const createDynamicField = (header: string) => {
    const key = makeAttributeKey(header);
    const field: AttributeDefinition = {
      key,
      label: titleCase(header),
      type: inferType(rows.map((row) => row[header])),
      group: customImportFieldGroup,
      required: false,
      visible: true,
      downstreamSystems: [],
    };
    setCreatedFields((current) => current.some((item) => item.key === key) ? current : [...current, field]);
    setMapping({ ...mapping, [header]: 'create_dynamic_attribute' });
    setCommitted(false);
    setCommitResult(null);
    setCommitProgress(null);
    setStage('mapping');
  };

  const createDynamicFieldsForHeaders = (headersToCreate: string[]) => {
    const nextFields = [...createdFields];
    headersToCreate.forEach((header) => {
      const key = makeAttributeKey(header);
      if (!key || nextFields.some((field) => field.key === key) || attributes.some((field) => field.key === key)) return;
      nextFields.push({
        key,
        label: titleCase(header),
        type: inferType(rows.map((row) => row[header])),
        group: customImportFieldGroup,
        required: false,
        visible: true,
        downstreamSystems: [],
      });
    });
    setCreatedFields(nextFields);
  };

  const setAllFieldsToDynamicAttributes = () => {
    const headersToCreate = headers.filter((header) => mapping[header] !== 'roomCode');
    createDynamicFieldsForHeaders(headersToCreate);
    setMapping({
      ...mapping,
      ...Object.fromEntries(headersToCreate.map((header) => [header, 'create_dynamic_attribute'])),
    });
    setCommitted(false);
    setCommitResult(null);
    setCommitError('');
    setCommitProgress(null);
  };

  const applyImportLocally = () => {
    const validRows = preview.filter((row) => row.action !== 'error');
    const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
    const nextRooms = [...rooms];
    validRows.forEach((previewRow) => {
      const source = previewRow.source;
      const code = roomCodeHeader ? source[roomCodeHeader] : `IMPORT.${previewRow.id}`;
      const existingIndex = nextRooms.findIndex((room) => room.roomCode === code);
      const mapped = mapSourceToRoom(source, mapping, importAttributeDefinitions);
      if (existingIndex >= 0) {
        nextRooms[existingIndex] = {
          ...nextRooms[existingIndex],
          ...mapped,
          attributes: {
            ...nextRooms[existingIndex].attributes,
            ...(mapped.attributes ?? {}),
          },
          qualityFlags: [...new Set([...nextRooms[existingIndex].qualityFlags, 'Imported update pending governance review'])],
        };
      } else {
        nextRooms.push({
          id: `import-${Date.now()}-${previewRow.id}`,
          roomCode: code,
          name: mapped.name ?? code,
          campus: mapped.campus ?? 'Unmapped Campus',
          building: mapped.building ?? 'Unmapped Building',
          floor: mapped.floor ?? 'Unmapped Floor',
          type: 'Imported',
          category: 'Support Space',
          pattern: mapped.pattern ?? 'Meeting Room',
          capacity: Number(mapped.capacity) || 0,
          owner: mapped.owner ?? 'Unassigned',
          bookingStatus: mapped.bookingStatus ?? 'Imported for review',
          isTeaching: false,
          isBookable: false,
          isStudentAccessible: false,
          isStaffOnly: false,
          isSpecialist: false,
          isArchived: false,
          physicalNotes: 'Imported from CSV and awaiting review.',
          bookingNotes: 'Booking configuration requires governance review.',
          capabilities: [],
          attributes: mapped.attributes ?? {},
          downstreamSystems: ['Archibus'],
          qualityFlags: ['Imported record pending validation'],
        });
      }
    });
    setRooms(nextRooms);
    setAttributes(mergeAttributeDefinitions(attributes, importAttributeDefinitions));
  };

  const commitImport = async () => {
    if (!requireAuthenticatedEdit('commit imports')) return;
    setIsCommitting(true);
    setCommitError('');
    setCommitted(false);
    setCommitResult(null);
    setCommitProgress({
      percent: 0,
      message: 'Starting import.',
      processedRows: 0,
      totalRows: preview.filter((row) => row.action !== 'error').length,
      created: 0,
      updated: 0,
      attributeValues: 0,
    });
    try {
      const result = await persistImportToSupabase({
        filename,
        rows: preview,
        mapping,
        createdFields: importAttributeDefinitions,
        onProgress: setCommitProgress,
      });
      applyImportLocally();
      setCommitResult(result);
      setCommitted(true);
      setStage('approval');
      if (result.action === 'supabase') await refreshRoomData();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : 'Import failed while saving to Supabase.');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Dictionary-Ready Room Import" description="Upload room data, map source columns to core room fields or any governed data dictionary field, validate impacts, and commit controlled updates." />
      <section className="grid gap-6">
        <div className="panel rounded-lg p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            <ImportStep icon={Upload} title="1. Upload file" detail="CSV with UTF-8 headers and room rows." active={stage === 'upload'} complete={headers.length > 0} />
            <ImportStep icon={Filter} title="2. Map and validate" detail={`${roomDataDictionaryDefinitions.length} dictionary fields are ready.`} active={stage === 'mapping'} complete={canApproveImport || stage === 'approval'} />
            <ImportStep icon={CheckCircle2} title="3. Approve and commit" detail="Review impact summary before committing." active={stage === 'approval'} complete={committed} />
          </div>
          <div className="mt-5">
            <label className="btn-primary cursor-pointer">
              <Upload size={16} />
              Upload CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </label>
          </div>
        </div>

        {headers.length > 0 && stage === 'mapping' && (
          <div className="panel rounded-lg">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <Settings2 size={18} className="text-ecu-teal" />
                <h3 className="font-bold text-slate-950">Column Mapping</h3>
              </div>
              <button className="btn-secondary" onClick={setAllFieldsToDynamicAttributes}>
                <Plus size={16} /> Set unmapped fields to dynamic attributes
              </button>
            </div>
            <div className="grid gap-3 p-4">
              {headers.map((header) => (
                <div key={header} className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-[1fr_1fr_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-slate-900">{header}</p>
                    <p className="text-sm text-slate-500">Sample: {rows[0]?.[header] || 'No value'}</p>
                  </div>
                  <select className="input" value={mapping[header] ?? 'ignore'} onChange={(event) => {
                    setMapping({ ...mapping, [header]: event.target.value });
                    setCommitted(false);
                    setCommitResult(null);
                    setCommitProgress(null);
                  }}>
                    <optgroup label="Core room fields">
                      {coreRoomFieldOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </optgroup>
                    <optgroup label="Data dictionary fields">
                      {attributeFieldOptions.map((option) => <option key={option.key} value={`attr:${option.key}`}>{formatAttributeOptionLabel(option)}</option>)}
                    </optgroup>
                  </select>
                  <button className="btn-secondary" onClick={() => createDynamicField(header)}><Plus size={16} /> Create field</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {preview.length > 0 && stage === 'mapping' && (
          <div className="panel rounded-lg">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-bold text-slate-950">Validation Preview</h3>
                <p className="text-sm text-slate-600">
                  {preview.filter((row) => row.action === 'create').length} create · {preview.filter((row) => row.action === 'update').length} update · {preview.filter((row) => row.action === 'error').length} errors · {mappedDictionaryDefinitions.length} dictionary fields · {mappedDynamicDefinitions.length} new fields
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setStage('upload')}><Upload size={16} /> Back to upload</button>
                <button className="btn-primary" disabled={!canApproveImport} onClick={() => setStage('approval')}><ChevronRight size={16} /> Continue to approve and commit</button>
              </div>
            </div>
            {!hasRoomCodeMapping && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Map one CSV column to Room Code before moving to approval.
              </div>
            )}
            {errorRows.length > 0 && (
              <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-semibold">Resolve {errorRows.length} validation error{errorRows.length === 1 ? '' : 's'} before approving this import.</p>
                <p className="mt-1">
                  {errorRows.slice(0, 8).map((row) => `Row ${row.id}: ${row.issues.filter((issue) => issue.startsWith('Invalid') || issue.startsWith('Missing')).join(', ')}`).join(' | ')}
                  {errorRows.length > 8 ? ` | ${errorRows.length - 8} more` : ''}
                </p>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Row</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Room code</th>
                    <th className="px-4 py-3">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {previewRowsToShow.map((row) => {
                    const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
                    return (
                      <tr key={row.id} className={row.action === 'error' ? 'bg-red-50' : undefined}>
                        <td className="px-4 py-3">{row.id}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.action} /></td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{roomCodeHeader ? row.source[roomCodeHeader] : 'Unmapped'}</td>
                        <td className="px-4 py-3 text-slate-600">{row.issues.join(', ') || 'Ready'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stage === 'approval' && preview.length > 0 && (
          <div className="panel rounded-lg">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="font-bold text-slate-950">Approve and Commit</h3>
                <p className="text-sm text-slate-600">Review the import impact, then commit the validated rows into the room dataset.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary" onClick={() => setStage('mapping')}><Filter size={16} /> Back to mapping</button>
                <button className="btn-primary" disabled={!canApproveImport || committed || isCommitting} onClick={commitImport}>
                  <CheckCircle2 size={16} /> {isCommitting ? 'Committing...' : 'Commit import'}
                </button>
              </div>
            </div>
            <div className={cn('border-b px-4 py-3 text-sm', isSupabaseConfigured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
              {isSupabaseConfigured
                ? 'Supabase is configured. This import will be written to import_jobs, rooms, room_attribute_definitions, room_attribute_values, and room_change_log.'
                : 'Supabase is not configured. This commit will update demo data only and will be lost on refresh.'}
            </div>
            {commitError && (
              <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {commitError}
              </div>
            )}
            {commitProgress && (
              <ImportProgressPanel progress={commitProgress} complete={committed} />
            )}
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Plus} label="Rows to create" value={rowsToCreate} detail="New room records" />
              <MetricCard icon={RefreshCcw} label="Rows to update" value={rowsToUpdate} detail="Existing room records" />
              <MetricCard icon={KeyRound} label="New fields" value={mappedDynamicDefinitions.length} detail={mappedDynamicDefinitions.slice(0, 4).map((field) => field.label).join(', ') || 'None'} />
              <MetricCard icon={AlertTriangle} label="Validation errors" value={errorRows.length} detail={errorRows.length ? 'Return to mapping' : 'Ready to commit'} />
            </div>
            <div className="border-t border-slate-200 p-4">
              <MiniList
                title="Governance impact"
                items={[
                  'Import audit history will be recorded',
                  'Updated rooms are flagged for governance review',
                  'Mapped dictionary fields are added as configurable room attributes',
                  'Future Supabase mode maps this flow to import_jobs and room_change_log',
                ]}
              />
            </div>
          </div>
        )}

        {committed && (
          <ImportCompletionSummary
            result={commitResult}
            importedFields={importAttributeDefinitions}
            newFields={mappedDynamicDefinitions}
            fallbackCreated={rowsToCreate}
            fallbackUpdated={rowsToUpdate}
          />
        )}
      </section>
    </>
  );
}

function ImportStep({ icon: Icon, title, detail, active, complete }: { icon: typeof Home; title: string; detail: string; active: boolean; complete: boolean }) {
  return (
    <div className={cn('rounded-md border p-4', active ? 'border-ecu-teal bg-ecu-mint' : complete ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white')}>
      <Icon className={active ? 'text-ecu-teal' : complete ? 'text-emerald-600' : 'text-slate-400'} size={20} />
      <p className="mt-3 font-bold text-slate-950">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function ImportProgressPanel({ progress, complete }: { progress: PersistImportProgress; complete: boolean }) {
  return (
    <div className={cn('border-b px-4 py-4 text-sm', complete ? 'border-emerald-200 bg-emerald-50' : 'border-ecu-teal/30 bg-ecu-mint')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold text-slate-950">{complete ? 'Import complete' : 'Import in progress'}</p>
          <p className="mt-1 text-slate-700">{progress.message}</p>
        </div>
        <span className="badge border-white bg-white text-slate-700">
          {progress.percent}% complete
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div
          className={cn('h-full rounded-full transition-all', complete ? 'bg-emerald-500' : 'bg-ecu-teal')}
          style={{ width: `${Math.max(progress.percent, complete ? 100 : 4)}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
        <span>{progress.processedRows.toLocaleString()} of {progress.totalRows.toLocaleString()} rows</span>
        <span>{progress.created.toLocaleString()} created</span>
        <span>{progress.updated.toLocaleString()} updated</span>
        <span>{progress.attributeValues.toLocaleString()} attribute value{progress.attributeValues === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}

function ImportCompletionSummary({
  result,
  importedFields,
  newFields,
  fallbackCreated,
  fallbackUpdated,
}: {
  result: PersistImportResult | null;
  importedFields: AttributeDefinition[];
  newFields: AttributeDefinition[];
  fallbackCreated: number;
  fallbackUpdated: number;
}) {
  const created = result?.created ?? fallbackCreated;
  const updated = result?.updated ?? fallbackUpdated;
  const newFieldLabels = result ? result.newFields : newFields.map((field) => field.label);
  const importedFieldLabels = importedFields.map((field) => field.label);

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} />
        <div>
          <p className="font-bold text-emerald-950">
            Import complete{result?.action === 'supabase' && result.importJobId ? `: ${result.importJobId}` : ''}
          </p>
          <p className="mt-1">
            Imported {created.toLocaleString()} new room{created === 1 ? '' : 's'} and updated {updated.toLocaleString()} existing room{updated === 1 ? '' : 's'}.
            {result?.attributeValues ? ` Saved ${result.attributeValues.toLocaleString()} dynamic attribute value${result.attributeValues === 1 ? '' : 's'}.` : ''}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <MiniList
              title="New fields created"
              items={newFieldLabels.length ? newFieldLabels : ['No new dynamic fields were created']}
            />
            <MiniList
              title="Imported attribute fields"
              items={importedFieldLabels.length ? importedFieldLabels.slice(0, 8) : ['No dynamic or dictionary attributes were mapped']}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function suggestMapping(header: string, attributeOptions: AttributeDefinition[] = roomDataDictionaryDefinitions) {
  const normal = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['roomno', 'roomnumber', 'roomcode', 'room'].includes(normal)) return 'roomCode';
  if (['campusid'].includes(normal)) return 'campus';
  if (['buildingid'].includes(normal)) return 'building';
  if (['roomname', 'name'].includes(normal)) return 'name';
  if (normal === 'finalroomname') return 'name';

  const dictionaryDefinition = findAttributeDefinitionForHeader(header, attributeOptions);
  if (dictionaryDefinition) return `attr:${dictionaryDefinition.key}`;

  if (normal === 'fullroomnumber') return 'roomCode';
  if (normal === 'floor' || normal === 'outlookfloorsnumberonly') return 'floor';
  if (normal.includes('campus')) return 'campus';
  if (normal.includes('building')) return 'building';
  if (normal.includes('floor') && !normal.includes('floorplan')) return 'floor';
  if (normal.includes('capacity') || normal === 'cap') return 'capacity';
  if (normal.includes('owner')) return 'owner';
  if (normal.includes('type') || normal.includes('pattern')) return 'pattern';

  return 'ignore';
}

function inferType(values: string[]): AttributeDefinition['type'] {
  const sample = values.filter(Boolean).slice(0, 10);
  if (sample.every((value) => ['yes', 'no', 'true', 'false', 'y', 'n'].includes(value.toLowerCase()))) return 'boolean';
  if (sample.every((value) => !Number.isNaN(Number(value)))) return 'number';
  if (sample.every((value) => !Number.isNaN(Date.parse(value)))) return 'date';
  if (sample.some((value) => value.includes(','))) return 'multi-select';
  return 'text';
}

function mapSourceToRoom(source: Record<string, string>, mapping: Record<string, string>, dynamicFields: AttributeDefinition[]): ImportedRoomFields {
  const result: ImportedRoomFields = { attributes: {} };
  Object.entries(mapping).forEach(([header, destination]) => {
    const value = source[header];
    if (!value || destination === 'ignore') return;
    if (destination === 'create_dynamic_attribute') {
      const key = makeAttributeKey(header);
      const field = dynamicFields.find((item) => item.key === key);
      result.attributes![key] = coerceImportValue(value, field?.type ?? 'text');
    } else if (destination.startsWith('attr:')) {
      const key = destination.slice(5);
      const field = dynamicFields.find((item) => item.key === key) ?? roomDataDictionaryByKey.get(key);
      result.attributes![key] = coerceImportValue(value, field?.type ?? 'text');
    } else {
      switch (destination) {
        case 'roomCode':
        case 'name':
        case 'campus':
        case 'building':
        case 'floor':
        case 'owner':
        case 'pattern':
        case 'bookingStatus':
          result[destination] = value;
          break;
        case 'capacity':
          result.capacity = Number(value);
          break;
        default:
          break;
      }
    }
  });
  return result;
}

function mergeAttributeDefinitions(...groups: AttributeDefinition[][]) {
  const byKey = new Map<string, AttributeDefinition>();
  groups.flat().forEach((attribute) => byKey.set(attribute.key, attribute));
  return Array.from(byKey.values());
}

function getDynamicAttributeDefinitionsFromMapping(
  mapping: Record<string, string>,
  rows: Record<string, string>[],
  existingAttributes: AttributeDefinition[] = [],
) {
  return Object.entries(mapping).flatMap(([header, destination]) => {
    if (destination !== 'create_dynamic_attribute') return [];
    const key = makeAttributeKey(header);
    if (!key) return [];
    const existing = existingAttributes.find((attribute) => attribute.key === key);
    if (existing) return [existing];

    return [{
      key,
      label: titleCase(header),
      type: inferType(rows.map((row) => row[header])),
      group: customImportFieldGroup,
      required: false,
      visible: true,
      downstreamSystems: [],
    }];
  });
}

function normalizeAttributeGroup(group?: string) {
  if (!group || group === 'Imported') return customImportFieldGroup;
  return group;
}

function formatAttributeOptionLabel(attribute: AttributeDefinition) {
  const group = normalizeAttributeGroup(attribute.group);
  if (group === customImportFieldGroup) return attribute.label;
  return `${group} - ${attribute.label}`;
}

function formatAttributeValue(value: string | number | boolean | string[]) {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function buildRoomProfileFields(room: Room, attributes: AttributeDefinition[]): RoomProfileFieldRow[] {
  const attributeRows = Object.entries(room.attributes).map(([key, value]) => {
    const definition = attributes.find((attribute) => attribute.key === key)
      ?? roomDataDictionaryByKey.get(key)
      ?? findAttributeDefinitionForHeader(key);
    const group = normalizeAttributeGroup(definition?.group);
    const sourceSystem = inferFieldSourceSystem(definition, group);

    return {
      key,
      tab: inferRoomProfileTab(definition?.group ?? group, definition?.label ?? key),
      group,
      label: definition?.label ?? titleCase(key),
      value: formatAttributeValue(value),
      rawValue: value,
      description: definition?.description ?? '',
      sourceSystem,
      type: definition?.type ?? 'text',
      required: definition?.required ?? false,
      updatedAt: definition?.updatedAt,
    };
  });

  const coreRows: RoomProfileFieldRow[] = [
    createCoreRoomProfileField('room_code', 'Room ID', room.roomCode, 'Canonical room identifier', 'Core room record', 'Overview', coreRoomProfileGroup, 'system reference', true),
    createCoreRoomProfileField('room_name', 'Room name', getRoomFinalName(room) || room.name, 'Final room name shown in room search and profile views', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', true),
    createCoreRoomProfileField('assigned_department', 'Assigned department', room.owner, 'Department responsible for the space', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', false),
    createCoreRoomProfileField('room_type', 'Room type', room.type || room.category, 'Room type or category classification', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', false),
    createCoreRoomProfileField('campus', 'Campus', room.campus, 'Campus where the room is located', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', true),
    createCoreRoomProfileField('building', 'Building', room.building, 'Building where the room is located', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', true),
    createCoreRoomProfileField('floor', 'Floor', room.floor, 'Floor number or label', 'Core room record', 'Overview', coreRoomProfileGroup, 'text', false),
    createCoreRoomProfileField('capacity', 'Capacity', getRoomCapacityDisplay(room, attributes), 'Number of people the room can accommodate', 'Core room record', 'Overview', coreRoomProfileGroup, 'number', false),
  ];

  return [...coreRows, ...attributeRows]
    .filter((row, index, rows) => rows.findIndex((item) => item.key === row.key) === index)
    .sort((a, b) => roomProfileTabs.indexOf(a.tab) - roomProfileTabs.indexOf(b.tab) || compareRoomProfileGroups(a.group, b.group) || a.label.localeCompare(b.label));
}

function createCoreRoomProfileField(
  key: string,
  label: string,
  value: string | number | boolean | string[],
  description: string,
  sourceSystem: string,
  tab: string,
  group: string,
  type: AttributeDefinition['type'],
  required: boolean,
): RoomProfileFieldRow {
  return {
    key,
    tab,
    group,
    label,
    value: formatAttributeValue(value),
    rawValue: value,
    description,
    sourceSystem,
    type,
    required,
  };
}

function inferRoomProfileTab(group: string, label: string) {
  const text = `${group} ${label}`.toLowerCase();
  if (text.includes('identification') || text.includes('identifier') || text.includes('archibus') || text.includes('id')) return 'Identification';
  if (text.includes('timetable') || text.includes('teaching') || text.includes('outlook') || text.includes('o365')) return 'Timetabling';
  if (text.includes('technology') || text.includes('av') || text.includes('appspace') || text.includes('hector') || text.includes('compute')) return 'Technology';
  if (text.includes('booking') || text.includes('bookable') || text.includes('momentus') || text.includes('panel')) return 'Booking';
  if (text.includes('governance') || text.includes('security') || text.includes('access') || text.includes('owner')) return 'Governance';
  return 'Overview';
}

function inferFieldSourceSystem(definition: AttributeDefinition | undefined, group: string) {
  const systems = definition?.downstreamSystems ?? [];
  if (systems.length) return systems[0];
  const text = `${definition?.label ?? ''} ${definition?.sourceField ?? ''} ${group}`.toLowerCase();
  if (text.includes('archibus') || text.includes('afm.rm')) return 'Archibus';
  if (text.includes('outlook') || text.includes('o365')) return 'O365';
  if (text.includes('timetable')) return 'Timetabling';
  if (text.includes('appspace')) return 'Appspace';
  if (text.includes('momentus')) return 'Momentus';
  return 'Unknown';
}

function compareRoomProfileGroups(a: string, b: string) {
  const preferred = [coreRoomProfileGroup];
  const aIndex = preferred.indexOf(a);
  const bIndex = preferred.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? preferred.length : aIndex) - (bIndex === -1 ? preferred.length : bIndex);
  return compareRoomDataDictionaryGroups(a, b);
}

function coerceEditedAttributeValue(value: string, type: AttributeDefinition['type'], previousValue: string | number | boolean | string[]) {
  if (Array.isArray(previousValue)) return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (type === 'boolean') return ['yes', 'true', '1', 'y'].includes(value.trim().toLowerCase());
  if (type === 'number') return Number(value) || 0;
  if (type === 'multi-select' || type === 'tag') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return value;
}

function formatFieldTimestamp(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function buildFieldHistoryItems(field: RoomProfileFieldRow) {
  return [
    {
      title: formatFieldTimestamp(field.updatedAt) || 'No timestamp recorded',
      actor: 'System',
      detail: `Current value is ${field.value || 'empty'}.`,
      source: field.sourceSystem,
    },
  ];
}

function getRoomAttributeDefinitions(attributes: AttributeDefinition[]) {
  const byKey = new Map([...roomDataDictionaryDefinitions, ...attributes].map((attribute) => [attribute.key, attribute]));
  return Array.from(byKey.values())
    .map((attribute) => {
      const dictionaryDefinition = roomDataDictionaryByKey.get(attribute.key)
        ?? findAttributeDefinitionForHeader(attribute.label)
        ?? findAttributeDefinitionForHeader(attribute.key);
      const loadedGroup = normalizeAttributeGroup(attribute.group);
      const group = loadedGroup === customImportFieldGroup
        ? dictionaryDefinition?.group ?? loadedGroup
        : loadedGroup;

      return {
        ...dictionaryDefinition,
        ...attribute,
        description: attribute.description ?? dictionaryDefinition?.description,
        group: normalizeAttributeGroup(group),
      };
    })
    .sort((a, b) => compareRoomDataDictionaryGroups(a.group, b.group) || a.label.localeCompare(b.label));
}

function getGroupedRoomAttributeDefinitions(attributes: AttributeDefinition[]) {
  return getRoomAttributeDefinitions(attributes).reduce<[string, AttributeDefinition[]][]>((groups, attribute) => {
    const existingGroup = groups.find(([group]) => group === attribute.group);
    if (existingGroup) existingGroup[1].push(attribute);
    else groups.push([attribute.group, [attribute]]);
    return groups;
  }, []);
}

function getAttributeGroupOptions(attributes: AttributeDefinition[], extraGroups: string[] = []) {
  return [...new Set([...attributes.map((attribute) => normalizeAttributeGroup(attribute.group)), ...extraGroups.map(normalizeAttributeGroup)].filter(Boolean))]
    .sort(compareRoomDataDictionaryGroups);
}

function getAttributeGroupsFromDefinitions(attributes: AttributeDefinition[]): AttributeGroup[] {
  return getAttributeGroupOptions(attributes).map((name, index) => ({ name, sortOrder: index }));
}

function mergeAttributeGroups(...groups: AttributeGroup[][]) {
  const byName = new Map<string, AttributeGroup>();
  groups.flat().forEach((group) => {
    const name = normalizeAttributeGroup(group.name);
    if (!name) return;
    byName.set(name, { ...byName.get(name), ...group, name });
  });
  return Array.from(byName.values()).sort((a, b) => compareRoomDataDictionaryGroups(a.name, b.name));
}

function isRecentDate(value?: string) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
}

function getVisibleRoomAttributeBadges(room: Room, attributes: AttributeDefinition[], limit = 6) {
  const definitionsByKey = new Map(attributes.map((attribute) => [attribute.key, attribute]));
  return Object.entries(room.attributes)
    .flatMap(([key, value]) => {
      if (key === finalRoomNameAttributeKey || roomCapacityAttributeKeys.includes(key)) return [];
      const displayValue = formatAttributeValue(value).trim();
      if (!displayValue) return [];
      const definition = definitionsByKey.get(key) ?? roomDataDictionaryByKey.get(key);
      if (definition?.visible === false) return [];
      return [{
        key,
        label: definition?.label ?? titleCase(key),
        value: displayValue,
        group: normalizeAttributeGroup(definition?.group),
      }];
    })
    .sort((a, b) => compareRoomDataDictionaryGroups(a.group, b.group) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function isTruthyAttributeValue(value: string | number | boolean | string[] | undefined) {
  if (Array.isArray(value)) return value.some(isTruthyAttributeValue);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return ['yes', 'true', 'y', '1', 'bookable', 'available', 'in scope', 'enabled'].includes(normalized);
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
