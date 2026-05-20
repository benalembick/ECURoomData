import { ChangeEvent, type FormEvent, type MouseEvent as ReactMouseEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { z } from 'zod';
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  GitBranch,
  History,
  Home,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  ListChecks,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
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
import type { AttributeDefinition, Building, Campus, ChangeRequest, DatabaseRole, ImportPreviewRow, Room, RoomPattern, TaskStatus, UserProfile } from './types';
import { cn, downloadCsv, titleCase } from './lib/utils';
import { buildingDisplayName, floorNameFromCode, parseRoomCode } from './lib/roomCode';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { persistImportToSupabase, type PersistImportProgress, type PersistImportResult } from './services/importPersistence';
import { persistBuildingDetails, persistBuildingRemoval, persistCampusDetails, persistCampusMapping, persistCampusRemoval, type CampusMappingProgress } from './services/campusPersistence';
import { createDataBackup, deleteDataBackup, getBackupOperation, listDataBackups, restoreDataBackup, type BackupOperation, type DataBackupSet } from './services/dataBackups';
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

type View =
  | 'dashboard'
  | 'rooms'
  | 'room-detail'
  | 'admin'
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
  { id: 'admin', label: 'Room Admin', icon: Settings2 },
  { id: 'locations', label: 'Campuses', icon: Building2 },
  { id: 'patterns', label: 'Patterns', icon: Layers3 },
  { id: 'rules', label: 'Rules', icon: GitBranch },
  { id: 'governance', label: 'Governance', icon: ClipboardCheck },
  { id: 'import', label: 'Import', icon: FileSpreadsheet },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'users', label: 'Users', icon: Users },
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
  return value.trim().toUpperCase().replace(/\s+/g, '');
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
  if (normalized === 'level basement') return -30;
  if (normalized === 'level ground') return -20;
  if (normalized === 'level mezzanine') return -10;
  const levelNumber = normalized.match(/^level\s+(\d+)$/)?.[1];
  if (levelNumber) return Number(levelNumber);
  return 1000;
}

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [campusesData, setCampusesData] = useState<Campus[]>(initialCampuses);
  const [buildingsData, setBuildingsData] = useState<Building[]>(initialBuildings);
  const [roomPatterns, setRoomPatterns] = useState<RoomPattern[]>(initialPatterns);
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>(initialAttributeDefinitions);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(initialChangeRequests);
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
  const visibleNavItems = navItems.filter((item) => !['users', 'backups'].includes(item.id) || canManageUsers);

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
    setView('rooms');
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
                    setView(item.id);
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
          </nav>
          <div className="hidden border-t border-slate-200 p-4 text-sm text-slate-600 lg:block">
            <p className="font-semibold text-ecu-black">Role model</p>
            <p className="mt-1">Viewer, editor, system owner, approver, and admin permissions are represented in the schema and UI.</p>
          </div>
        </aside>

        <main className="p-4 sm:p-6 lg:p-8">
          {view === 'dashboard' && <Dashboard rooms={rooms} changeRequests={changeRequests} openRoom={openRoom} openSummarySearch={openSummarySearch} roomDataLoading={roomDataLoading} />}
          {view === 'rooms' && <RoomSearch rooms={rooms} campuses={campusesData} attributes={attributeDefinitions} openRoom={openRoom} roomDataLoading={roomDataLoading} loadProgress={dataLoadProgress} summaryFilter={summaryFilter} clearSummaryFilter={() => setSummaryFilter(null)} />}
          {view === 'room-detail' && <RoomDetail room={selectedRoom} attributes={attributeDefinitions} openRoomAdmin={openRoomAdmin} />}
          {view === 'admin' && <Admin rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} campuses={campusesData} buildings={buildingsData} patterns={roomPatterns} initialRoomId={selectedRoomId} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'locations' && <CampusManagement rooms={rooms} setRooms={setRooms} campuses={campusesData} setCampuses={setCampusesData} buildings={buildingsData} setBuildings={setBuildingsData} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'patterns' && <Patterns rooms={rooms} setRooms={setRooms} patterns={roomPatterns} setPatterns={setRoomPatterns} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
          {view === 'rules' && <Rules />}
          {view === 'governance' && <Governance requests={changeRequests} setRequests={setChangeRequests} rooms={rooms} requireAuthenticatedEdit={requireAuthenticatedEdit} />}
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

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
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

function RoomSearch({
  rooms,
  campuses,
  attributes,
  openRoom,
  roomDataLoading,
  loadProgress,
  summaryFilter,
  clearSummaryFilter,
}: {
  rooms: Room[];
  campuses: Campus[];
  attributes: AttributeDefinition[];
  openRoom: (id: string) => void;
  roomDataLoading: boolean;
  loadProgress: RoomDataLoadProgress | null;
  summaryFilter: string | null;
  clearSummaryFilter: () => void;
}) {
  const [query, setQuery] = useState('');
  const [campus, setCampus] = useState('All');
  const [category, setCategory] = useState('All');
  const [flags, setFlags] = useState<string[]>([]);
  const [minCapacity, setMinCapacity] = useState('');
  const [capability, setCapability] = useState('');
  const deferredQuery = useDeferredValue(query);
  const deferredCapability = useDeferredValue(capability);
  const deferredMinCapacity = useDeferredValue(minCapacity);
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

function RoomDetail({ room, attributes, openRoomAdmin }: { room: Room; attributes: AttributeDefinition[]; openRoomAdmin: (roomId: string) => void }) {
  const roomMappings = mappings.filter((mapping) => mapping.roomId === room.id);
  const attributeRows = Object.entries(room.attributes).map(([key, value]) => {
    const loadedDefinition = attributes.find((attribute) => attribute.key === key);
    const dictionaryDefinition = roomDataDictionaryByKey.get(key)
      ?? (loadedDefinition ? findAttributeDefinitionForHeader(loadedDefinition.label) : undefined)
      ?? findAttributeDefinitionForHeader(key);
    const loadedGroup = normalizeAttributeGroup(loadedDefinition?.group);
    const definition = loadedDefinition ?? dictionaryDefinition;
    const group = loadedGroup === customImportFieldGroup ? dictionaryDefinition?.group ?? loadedGroup : loadedGroup;

    return {
      key,
      group: normalizeAttributeGroup(group),
      label: definition?.label ?? titleCase(key),
      value: formatAttributeValue(value),
      description: loadedDefinition?.description ?? dictionaryDefinition?.description,
    };
  }).sort((a, b) => compareRoomDataDictionaryGroups(a.group, b.group) || a.label.localeCompare(b.label));
  const groupedAttributeRows = attributeRows.reduce<Record<string, typeof attributeRows>>((groups, row) => {
    groups[row.group] = [...(groups[row.group] ?? []), row];
    return groups;
  }, {});
  const groupedAttributeEntries = Object.entries(groupedAttributeRows).sort(([a], [b]) => compareRoomDataDictionaryGroups(a, b));

  return (
    <>
      <PageHeader
        title={roomDisplayName(room)}
        description="A single governed room profile separating physical asset facts from booking, access, integration, and audit information."
        action={<button className="btn-primary" onClick={() => openRoomAdmin(room.id)}><Pencil size={16} /> Edit in Room Admin</button>}
      />
      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="panel rounded-lg p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Campus" value={room.campus} />
              <Fact label="Building" value={room.building} />
              <Fact label="Floor" value={room.floor} />
              <Fact label="Capacity" value={getRoomCapacityDisplay(room, attributes)} />
              <Fact label="Category" value={room.category} />
              <Fact label="Pattern" value={room.pattern} />
              <Fact label="Owner" value={room.owner} />
              <Fact label="Archived" value={room.isArchived ? 'Yes' : 'No'} />
            </div>
          </div>

          <TwoColumnPanel
            leftTitle="Physical Room Information"
            rightTitle="Booking and Access Information"
            left={<p className="text-sm leading-6 text-slate-700">{room.physicalNotes}</p>}
            right={<p className="text-sm leading-6 text-slate-700">{room.bookingNotes}</p>}
          />

          <div className="panel rounded-lg">
            <SectionTitle icon={Database} title="Data Dictionary Fields" />
            <div className="space-y-4 p-4">
              {groupedAttributeEntries.length ? groupedAttributeEntries.map(([group, rows]) => (
                <section key={group}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-bold uppercase text-slate-700">{group}</h4>
                    <span className="badge border-slate-200 bg-slate-50 text-slate-600">{rows.length} populated</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((row) => (
                      <div key={row.key} className="rounded-md border border-slate-200 p-3">
                        <p className="label">{row.label}</p>
                        <p className="mt-1 break-words font-semibold text-slate-800">{row.value}</p>
                        {row.description && <p className="mt-2 text-xs leading-5 text-slate-500">{row.description}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )) : (
                <p className="text-sm text-slate-600">No dictionary attributes have been captured for this room yet.</p>
              )}
            </div>
          </div>

          <div className="panel rounded-lg">
            <SectionTitle icon={GitBranch} title="Downstream System Mappings" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">System</th>
                    <th className="px-4 py-3">External ID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last verified</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {roomMappings.map((mapping) => (
                    <tr key={mapping.systemName}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{mapping.systemName}</td>
                      <td className="px-4 py-3 text-slate-600">{mapping.externalId}</td>
                      <td className="px-4 py-3"><StatusBadge status={mapping.status} /></td>
                      <td className="px-4 py-3 text-slate-600">{mapping.lastVerified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
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
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Data Quality</h3>
            <div className="mt-3 space-y-2">
              {getActiveRoomQualityFlags(room).length ? getActiveRoomQualityFlags(room).map((flag) => (
                <div key={flag} className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{flag}</div>
              )) : <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">No known data conflicts.</div>}
            </div>
          </div>
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Audit Snapshot</h3>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p><History className="mr-2 inline" size={16} /> Last edited by Learning Environments</p>
              <p><ShieldCheck className="mr-2 inline" size={16} /> Governed attributes require approval</p>
              <p><RefreshCcw className="mr-2 inline" size={16} /> Downstream sync ready for future APIs</p>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}

function TwoColumnPanel({ leftTitle, rightTitle, left, right }: { leftTitle: string; rightTitle: string; left: React.ReactNode; right: React.ReactNode }) {
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
    setAttributes([
      ...attributes,
      {
        key: newAttribute.key.trim().toLowerCase().replace(/\s+/g, '_'),
        label: newAttribute.label,
        type: newAttribute.type as AttributeDefinition['type'],
        group: newAttribute.group,
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
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {attributes.map((attribute) => (
                <AttributeEditor
                  key={attribute.key}
                  attribute={attribute}
                  value={draft.attributes[attribute.key]}
                  onChange={(value) => updateDraftAttribute(attribute, value)}
                />
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

function PatternOverviewBlock({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
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

function Rules() {
  return (
    <>
      <PageHeader title="Transformation Rules" description="Rules describe how governed central room data maps into O365, Archibus, timetabling, Appspace, Momentus, security, and maintenance systems." />
      <div className="grid gap-4">
        {transformationRules.map((rule) => (
          <div key={rule.id} className="panel rounded-lg p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-950">{rule.name}</h3>
                  <StatusBadge status={rule.risk === 'high' ? 'High risk' : 'Standard'} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{rule.description}</p>
              </div>
              <StatusBadge status={rule.active ? 'Active' : 'Inactive'} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[0.8fr_1.2fr_0.7fr]">
              <MiniList title="Condition" items={[rule.condition]} />
              <MiniList title="Generated outputs" items={rule.outputs} />
              <MiniList title="Systems" items={rule.systems} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Governance({
  requests,
  setRequests,
  rooms,
  requireAuthenticatedEdit,
}: {
  requests: ChangeRequest[];
  setRequests: (requests: ChangeRequest[]) => void;
  rooms: Room[];
  requireAuthenticatedEdit: (action?: string) => boolean;
}) {
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

  return (
    <>
      <PageHeader title="Governance Workflow" description="Workflow engine for request intake, multi-stage approvals, generated operational action lists, manual completion, runbook references, and audit history." />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {['Under Review', 'Awaiting Information', 'Ready for Implementation', 'Implemented', 'Verified'].map((status) => (
          <MetricCard key={status} icon={ClipboardCheck} label={status} value={requests.filter((request) => request.status === status).length} detail="Governed change requests" />
        ))}
      </section>
      <div className="mt-6 grid gap-6">
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
                <MiniList title="Impacted systems" items={request.impactedSystems} />
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
