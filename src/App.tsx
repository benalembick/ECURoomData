import { ChangeEvent, useMemo, useState } from 'react';
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
  KeyRound,
  Layers3,
  ListChecks,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  attributeDefinitions as initialAttributeDefinitions,
  buildings,
  campuses,
  categories,
  changeRequests as initialChangeRequests,
  mappings,
  patterns,
  rooms as initialRooms,
  systems,
  transformationRules,
} from './data/mockData';
import type { AttributeDefinition, ChangeRequest, ImportPreviewRow, Room, TaskStatus } from './types';
import { cn, downloadCsv, titleCase } from './lib/utils';
import { isSupabaseConfigured } from './lib/supabase';

type View =
  | 'dashboard'
  | 'rooms'
  | 'room-detail'
  | 'admin'
  | 'patterns'
  | 'rules'
  | 'governance'
  | 'import';

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
  { id: 'patterns', label: 'Patterns', icon: Layers3 },
  { id: 'rules', label: 'Rules', icon: GitBranch },
  { id: 'governance', label: 'Governance', icon: ClipboardCheck },
  { id: 'import', label: 'Import', icon: FileSpreadsheet },
];

const ecuLogoUrl = 'https://www.ecu.edu.au/__data/assets/image/0015/1100571/1920w.png';

const fieldOptions = [
  'ignore',
  'roomCode',
  'name',
  'campus',
  'building',
  'floor',
  'capacity',
  'owner',
  'pattern',
  'bookingStatus',
  'student_bookable',
  'teams_enabled',
  'lecture_capture',
  'create_dynamic_attribute',
];

type ImportedRoomFields = Partial<
  Pick<Room, 'roomCode' | 'name' | 'campus' | 'building' | 'floor' | 'capacity' | 'owner' | 'pattern' | 'bookingStatus'>
> & {
  attributes?: Record<string, string | boolean | number | string[]>;
};

export function App() {
  const [view, setView] = useState<View>('dashboard');
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>(initialAttributeDefinitions);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>(initialChangeRequests);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRooms[0].id);
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];

  const openRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
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
              <p className="text-xs font-semibold uppercase tracking-wide text-ecu-green">Digital Campus Operations</p>
              <h1 className="text-xl font-bold text-ecu-black">Room Data Hub</h1>
            </div>
            <div className="hidden items-center gap-3 md:flex">
              <span className={cn('badge', isSupabaseConfigured ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>
                {isSupabaseConfigured ? 'Supabase connected' : 'Demo data mode'}
              </span>
              <span className="badge border-slate-200 bg-slate-50 text-slate-700">
                <ShieldCheck size={14} /> Admin
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-139px)] grid-cols-1 lg:grid-cols-[248px_1fr]">
        <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <nav className="flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
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
          {view === 'dashboard' && <Dashboard rooms={rooms} changeRequests={changeRequests} openRoom={openRoom} />}
          {view === 'rooms' && <RoomSearch rooms={rooms} openRoom={openRoom} />}
          {view === 'room-detail' && <RoomDetail room={selectedRoom} />}
          {view === 'admin' && <Admin rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} />}
          {view === 'patterns' && <Patterns />}
          {view === 'rules' && <Rules />}
          {view === 'governance' && <Governance requests={changeRequests} setRequests={setChangeRequests} rooms={rooms} />}
          {view === 'import' && <ImportWizard rooms={rooms} setRooms={setRooms} attributes={attributeDefinitions} setAttributes={setAttributeDefinitions} />}
        </main>
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

function Dashboard({ rooms, changeRequests, openRoom }: { rooms: Room[]; changeRequests: ChangeRequest[]; openRoom: (id: string) => void }) {
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
        <MetricCard icon={Building2} label="Enterprise room assets" value={rooms.length} detail={`${rooms.filter((room) => room.isBookable).length} bookable`} />
        <MetricCard icon={ClipboardCheck} label="Pending approvals" value={pendingApprovals} detail={`${highRisk} high-risk changes`} />
        <MetricCard icon={ListChecks} label="Open implementation tasks" value={implementationTasks.length} detail={`${implementationTasks.filter((task) => task.status === 'Blocked').length} blocked`} />
        <MetricCard icon={GitBranch} label="Connected systems" value={connectedSystems.size} detail="O365, Archibus, timetable and more" />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="panel rounded-lg">
          <div className="border-b border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Rooms Needing Attention</h3>
          </div>
          <div className="divide-y divide-slate-200">
            {rooms.filter((room) => room.qualityFlags.length).map((room) => (
              <button key={room.id} onClick={() => openRoom(room.id)} className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-slate-50">
                <div>
                  <p className="font-semibold text-slate-950">{room.roomCode} · {room.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{room.qualityFlags.join(', ')}</p>
                </div>
                <ChevronRight className="text-slate-400" size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="panel rounded-lg">
          <div className="border-b border-slate-200 p-4">
            <h3 className="font-bold text-slate-950">Impacted Systems Summary</h3>
          </div>
          <div className="space-y-3 p-4">
            {systems.map((system) => {
              const count = rooms.filter((room) => room.downstreamSystems.includes(system)).length;
              return (
                <div key={system}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-slate-700">{system}</span>
                    <span className="text-slate-500">{count} rooms</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-ecu-teal" style={{ width: `${Math.max(10, (count / rooms.length) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-2">
        <ChangeRequestList requests={changeRequests} compact />
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

function MetricCard({ icon: Icon, label, value, detail }: { icon: typeof Home; label: string; value: string | number; detail: string }) {
  return (
    <div className="panel rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="label">{label}</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
        </div>
        <div className="rounded-md bg-ecu-mint p-2 text-ecu-green">
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function RoomSearch({ rooms, openRoom }: { rooms: Room[]; openRoom: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [campus, setCampus] = useState('All');
  const [category, setCategory] = useState('All');
  const [flags, setFlags] = useState<string[]>([]);
  const [minCapacity, setMinCapacity] = useState('');
  const [capability, setCapability] = useState('');

  const filteredRooms = useMemo(() => {
    const q = query.toLowerCase();
    return rooms.filter((room) => {
      const textMatch = [room.roomCode, room.name, room.campus, room.building, room.floor, room.type, room.owner, room.bookingStatus, room.pattern, room.capabilities.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(q);
      const campusMatch = campus === 'All' || room.campus === campus;
      const categoryMatch = category === 'All' || room.category === category;
      const capacityMatch = !minCapacity || room.capacity >= Number(minCapacity);
      const capabilityMatch = !capability || room.capabilities.some((item) => item.toLowerCase().includes(capability.toLowerCase()));
      const flagMatch = flags.every((flag) => {
        if (flag === 'Teaching') return room.isTeaching;
        if (flag === 'Bookable') return room.isBookable;
        if (flag === 'Student accessible') return room.isStudentAccessible;
        if (flag === 'Staff only') return room.isStaffOnly;
        if (flag === 'Specialist') return room.isSpecialist;
        if (flag === 'WAAPA') return room.category.includes('WAAPA');
        if (flag === 'Library') return room.category.includes('Library');
        return true;
      });
      return textMatch && campusMatch && categoryMatch && capacityMatch && capabilityMatch && flagMatch;
    });
  }, [rooms, query, campus, category, flags, minCapacity, capability]);

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
          <FilterSelect label="Campus" value={campus} setValue={setCampus} options={['All', ...campuses.map((item) => item.name)]} />
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
          {['Teaching', 'Bookable', 'Student accessible', 'Staff only', 'Specialist', 'WAAPA', 'Library'].map((flag) => (
            <button
              key={flag}
              onClick={() => toggleFlag(flag)}
              className={cn('badge transition', flags.includes(flag) ? 'border-ecu-teal bg-ecu-mint text-ecu-black' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >
              {flag}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {filteredRooms.map((room) => (
          <button key={room.id} onClick={() => openRoom(room.id)} className="panel rounded-lg p-4 text-left hover:border-ecu-teal">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-950">{room.roomCode}</h3>
                  <span className="text-slate-500">{room.name}</span>
                  {room.qualityFlags.length > 0 && <span className="badge border-amber-200 bg-amber-50 text-amber-700"><AlertTriangle size={13} /> Data flag</span>}
                </div>
                <p className="mt-1 text-sm text-slate-600">{room.campus} · {room.building} · {room.floor}</p>
              </div>
              <div className="grid gap-2 text-sm sm:grid-cols-4 lg:min-w-[560px]">
                <Fact label="Pattern" value={room.pattern} />
                <Fact label="Capacity" value={room.capacity} />
                <Fact label="Booking" value={room.bookingStatus} />
                <Fact label="Owner" value={room.owner} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {room.capabilities.slice(0, 5).map((capabilityItem) => <span key={capabilityItem} className="badge border-slate-200 bg-slate-50 text-slate-600">{capabilityItem}</span>)}
            </div>
          </button>
        ))}
      </div>
    </>
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

function RoomDetail({ room }: { room: Room }) {
  const roomMappings = mappings.filter((mapping) => mapping.roomId === room.id);
  const attributeRows = Object.entries(room.attributes).map(([key, value]) => ({
    label: initialAttributeDefinitions.find((attribute) => attribute.key === key)?.label ?? titleCase(key),
    value: Array.isArray(value) ? value.join(', ') : String(value),
  }));

  return (
    <>
      <PageHeader
        title={`${room.roomCode} · ${room.name}`}
        description="A single governed room profile separating physical asset facts from booking, access, integration, and audit information."
      />
      <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="panel rounded-lg p-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Campus" value={room.campus} />
              <Fact label="Building" value={room.building} />
              <Fact label="Floor" value={room.floor} />
              <Fact label="Capacity" value={room.capacity} />
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
            <SectionTitle icon={Database} title="Structured Attributes" />
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {attributeRows.map((row) => (
                <div key={row.label} className="rounded-md border border-slate-200 p-3">
                  <p className="label">{row.label}</p>
                  <p className="mt-1 font-semibold text-slate-800">{row.value}</p>
                </div>
              ))}
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
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Capabilities</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {room.capabilities.map((capability) => <span key={capability} className="badge border-slate-200 bg-slate-50 text-slate-700">{capability}</span>)}
            </div>
          </div>
          <div className="panel rounded-lg p-4">
            <h3 className="font-bold text-slate-950">Data Quality</h3>
            <div className="mt-3 space-y-2">
              {room.qualityFlags.length ? room.qualityFlags.map((flag) => (
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

function Admin({ rooms, setRooms, attributes, setAttributes }: { rooms: Room[]; setRooms: (rooms: Room[]) => void; attributes: AttributeDefinition[]; setAttributes: (attributes: AttributeDefinition[]) => void }) {
  const [editingId, setEditingId] = useState(rooms[0].id);
  const room = rooms.find((item) => item.id === editingId) ?? rooms[0];
  const [draft, setDraft] = useState(room);
  const [newAttribute, setNewAttribute] = useState({ key: '', label: '', type: 'boolean', group: 'General' });

  const selectRoom = (id: string) => {
    const next = rooms.find((item) => item.id === id) ?? rooms[0];
    setEditingId(id);
    setDraft(next);
  };

  const saveRoom = () => {
    const parsed = roomSchema.safeParse(draft);
    if (!parsed.success) {
      alert('Please complete room code, name, campus, building, capacity, owner, and pattern.');
      return;
    }
    setRooms(rooms.map((item) => (item.id === draft.id ? { ...draft, qualityFlags: draft.qualityFlags.filter((flag) => flag !== 'Unsaved admin edits') } : item)));
  };

  const addAttribute = () => {
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
          <div className="max-h-[680px] overflow-auto p-2">
            {rooms.map((item) => (
              <button key={item.id} onClick={() => selectRoom(item.id)} className={cn('w-full rounded-md p-3 text-left text-sm hover:bg-slate-50', item.id === editingId && 'bg-ecu-mint text-ecu-black')}>
                <p className="font-bold">{item.roomCode}</p>
                <p className="text-slate-600">{item.name}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="panel rounded-lg p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TextInput label="Room code" value={draft.roomCode} onChange={(value) => setDraft({ ...draft, roomCode: value, qualityFlags: [...new Set([...draft.qualityFlags, 'Unsaved admin edits'])] })} />
              <TextInput label="Name" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
              <FilterSelect label="Campus" value={draft.campus} setValue={(value) => setDraft({ ...draft, campus: value })} options={campuses.map((item) => item.name)} />
              <FilterSelect label="Building" value={draft.building} setValue={(value) => setDraft({ ...draft, building: value })} options={buildings.map((item) => `${item.code} ${item.name}`)} />
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
          </div>

          <div className="panel rounded-lg">
            <SectionTitle icon={KeyRound} title="Configurable Attributes" />
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {attributes.map((attribute) => (
                <div key={attribute.key} className="rounded-md border border-slate-200 p-3">
                  <p className="font-semibold text-slate-900">{attribute.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{attribute.type} · {attribute.group}</p>
                  <p className="mt-2 text-xs text-slate-500">{attribute.downstreamSystems.join(', ') || 'No downstream mapping yet'}</p>
                </div>
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

function Patterns() {
  return (
    <>
      <PageHeader title="Room Patterns and Categories" description="Reusable governed patterns replace one-off configuration and define default booking, access, O365, approval, and downstream mapping behaviour." />
      <div className="grid gap-4 xl:grid-cols-2">
        {patterns.map((pattern) => (
          <div key={pattern.id} className="panel rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label">{pattern.category}</p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">{pattern.name}</h3>
              </div>
              <StatusBadge status={pattern.timetablingEligible ? 'Timetabling eligible' : 'Not timetabled'} />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{pattern.description}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <MiniList title="Booking rules" items={pattern.defaultBookingRules} />
              <MiniList title="Access logic" items={pattern.accessLogic} />
              <MiniList title="Required attributes" items={pattern.requiredAttributes} />
              <MiniList title="Downstream systems" items={pattern.downstreamSystems} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
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

function Governance({ requests, setRequests, rooms }: { requests: ChangeRequest[]; setRequests: (requests: ChangeRequest[]) => void; rooms: Room[] }) {
  const updateRequestStatus = (id: string, status: ChangeRequest['status']) => {
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
                  <p className="mt-1 text-sm text-slate-600">{room ? `${room.roomCode} · ${room.name}` : 'No room linked'} · {request.requestType}</p>
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

function ChangeRequestList({ requests, compact = false }: { requests: ChangeRequest[]; compact?: boolean }) {
  return (
    <div className="panel rounded-lg">
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-bold text-slate-950">Change Requests</h3>
      </div>
      <div className="divide-y divide-slate-200">
        {requests.slice(0, compact ? 3 : requests.length).map((request) => (
          <div key={request.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-950">{request.id} · {request.title}</p>
              <StatusBadge status={request.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">{request.impactedSystems.join(', ')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportWizard({ rooms, setRooms, attributes, setAttributes }: { rooms: Room[]; setRooms: (rooms: Room[]) => void; attributes: AttributeDefinition[]; setAttributes: (attributes: AttributeDefinition[]) => void }) {
  const [stage, setStage] = useState<ImportStage>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [createdFields, setCreatedFields] = useState<AttributeDefinition[]>([]);
  const [committed, setCommitted] = useState(false);

  const preview = useMemo<ImportPreviewRow[]>(() => {
    return rows.slice(0, 20).map((row, index) => {
      const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
      const roomCode = roomCodeHeader ? row[roomCodeHeader] : '';
      const issues: string[] = [];
      if (!roomCode) issues.push('Missing room code mapping');
      if (roomCode && !/^[A-Z]{2}\./.test(roomCode)) issues.push('Invalid room code format');
      const duplicate = rooms.some((room) => room.roomCode === roomCode);
      const unknownMappings = Object.values(mapping).filter((destination) => destination === 'create_dynamic_attribute').length;
      if (unknownMappings) issues.push(`${unknownMappings} dynamic field(s) to create`);
      return { id: index + 1, source: row, action: issues.some((issue) => issue.startsWith('Invalid') || issue.startsWith('Missing')) ? 'error' : duplicate ? 'update' : 'create', issues };
    });
  }, [rows, mapping, rooms]);

  const errorRows = preview.filter((row) => row.action === 'error');
  const rowsToCreate = preview.filter((row) => row.action === 'create').length;
  const rowsToUpdate = preview.filter((row) => row.action === 'update').length;
  const hasRoomCodeMapping = Object.values(mapping).includes('roomCode');
  const canApproveImport = preview.length > 0 && hasRoomCodeMapping && errorRows.length === 0;

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsedHeaders = result.meta.fields ?? [];
        setHeaders(parsedHeaders);
        setRows(result.data);
        setMapping(Object.fromEntries(parsedHeaders.map((header) => [header, suggestMapping(header)])));
        setCommitted(false);
        setStage('mapping');
      },
    });
  };

  const createDynamicField = (header: string) => {
    const key = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const field: AttributeDefinition = {
      key,
      label: titleCase(header),
      type: inferType(rows.map((row) => row[header])),
      group: 'Imported',
      required: false,
      visible: true,
      downstreamSystems: [],
    };
    setCreatedFields((current) => current.some((item) => item.key === key) ? current : [...current, field]);
    setMapping({ ...mapping, [header]: 'create_dynamic_attribute' });
    setStage('mapping');
  };

  const commitImport = () => {
    const validRows = preview.filter((row) => row.action !== 'error');
    const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
    const nextRooms = [...rooms];
    validRows.forEach((previewRow) => {
      const source = previewRow.source;
      const code = roomCodeHeader ? source[roomCodeHeader] : `IMPORT.${previewRow.id}`;
      const existingIndex = nextRooms.findIndex((room) => room.roomCode === code);
      const mapped = mapSourceToRoom(source, mapping, createdFields);
      if (existingIndex >= 0) {
        nextRooms[existingIndex] = { ...nextRooms[existingIndex], ...mapped, qualityFlags: [...new Set([...nextRooms[existingIndex].qualityFlags, 'Imported update pending governance review'])] };
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
    setAttributes([...attributes, ...createdFields.filter((field) => !attributes.some((attribute) => attribute.key === field.key))]);
    setCommitted(true);
    setStage('approval');
  };

  return (
    <>
      <PageHeader title="Advanced CSV Import" description="Upload, map, validate, create dynamic fields, preview impacts, and commit controlled room updates with import audit support." />
      <section className="grid gap-6">
        <div className="panel rounded-lg p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            <ImportStep icon={Upload} title="1. Upload file" detail="CSV with UTF-8 headers and room rows." active={stage === 'upload'} complete={headers.length > 0} />
            <ImportStep icon={Filter} title="2. Map and validate" detail="Map columns, create fields, review issues." active={stage === 'mapping'} complete={canApproveImport || stage === 'approval'} />
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
            <SectionTitle icon={Settings2} title="Column Mapping" />
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
                  }}>
                    {fieldOptions.map((option) => <option key={option} value={option}>{titleCase(option)}</option>)}
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
                  {preview.filter((row) => row.action === 'create').length} create · {preview.filter((row) => row.action === 'update').length} update · {preview.filter((row) => row.action === 'error').length} errors · {createdFields.length} new fields
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
                Resolve validation errors before approving this import.
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
                  {preview.map((row) => {
                    const roomCodeHeader = Object.entries(mapping).find(([, destination]) => destination === 'roomCode')?.[0];
                    return (
                      <tr key={row.id}>
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
                <button className="btn-primary" disabled={!canApproveImport || committed} onClick={commitImport}><CheckCircle2 size={16} /> Commit import</button>
              </div>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={Plus} label="Rows to create" value={rowsToCreate} detail="New room records" />
              <MetricCard icon={RefreshCcw} label="Rows to update" value={rowsToUpdate} detail="Existing room records" />
              <MetricCard icon={KeyRound} label="New dynamic fields" value={createdFields.length} detail={createdFields.map((field) => field.label).join(', ') || 'None'} />
              <MetricCard icon={AlertTriangle} label="Validation errors" value={errorRows.length} detail={errorRows.length ? 'Return to mapping' : 'Ready to commit'} />
            </div>
            <div className="border-t border-slate-200 p-4">
              <MiniList
                title="Governance impact"
                items={[
                  'Import audit history will be recorded',
                  'Updated rooms are flagged for governance review',
                  'Dynamic fields are added as configurable room attributes',
                  'Future Supabase mode maps this flow to import_jobs and room_change_log',
                ]}
              />
            </div>
          </div>
        )}

        {committed && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Import committed to the in-browser MVP dataset. In Supabase mode, this maps to import_jobs, room_change_log, dynamic attribute definitions, and governance approval records.
          </div>
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

function suggestMapping(header: string) {
  const normal = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['roomno', 'roomnumber', 'roomcode', 'room'].includes(normal)) return 'roomCode';
  if (['roomname', 'name'].includes(normal)) return 'name';
  if (normal.includes('campus')) return 'campus';
  if (normal.includes('building')) return 'building';
  if (normal.includes('floor')) return 'floor';
  if (normal.includes('capacity') || normal === 'cap') return 'capacity';
  if (normal.includes('owner')) return 'owner';
  if (normal.includes('type') || normal.includes('pattern')) return 'pattern';
  if (normal.includes('bookable')) return 'student_bookable';
  if (normal.includes('teams')) return 'teams_enabled';
  if (normal.includes('lecturecapture')) return 'lecture_capture';
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
      const key = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const field = dynamicFields.find((item) => item.key === key);
      result.attributes![key] = coerceImportValue(value, field?.type ?? 'text');
    } else if (['student_bookable', 'teams_enabled', 'lecture_capture'].includes(destination)) {
      result.attributes![destination] = coerceImportValue(value, 'boolean');
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

function coerceImportValue(value: string, type: AttributeDefinition['type']) {
  if (type === 'boolean') return ['yes', 'true', 'y', '1'].includes(value.toLowerCase());
  if (type === 'number') return Number(value);
  if (type === 'multi-select') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return value;
}
