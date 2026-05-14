create extension if not exists "uuid-ossp";

create type public.user_role as enum ('viewer', 'room_data_editor', 'system_owner', 'approver', 'admin');
create type public.attribute_type as enum ('text', 'boolean', 'number', 'date', 'select', 'multi_select', 'tag', 'url', 'system_reference');
create type public.request_status as enum (
  'draft',
  'submitted',
  'under_review',
  'awaiting_information',
  'approved',
  'rejected',
  'ready_for_implementation',
  'implemented',
  'verified',
  'closed'
);
create type public.implementation_status as enum ('not_started', 'in_progress', 'blocked', 'completed', 'verified');
create type public.import_status as enum ('draft', 'mapped', 'validated', 'awaiting_approval', 'committed', 'failed', 'rolled_back');

create table public.roles (
  id uuid primary key default uuid_generate_v4(),
  name public.user_role not null unique,
  description text not null
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null unique,
  role public.user_role not null default 'viewer',
  business_unit text,
  created_at timestamptz not null default now()
);

create table public.campuses (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  address text,
  is_active boolean not null default true
);

create table public.buildings (
  id uuid primary key default uuid_generate_v4(),
  campus_id uuid not null references public.campuses(id),
  code text not null,
  name text not null,
  owner text,
  is_active boolean not null default true,
  unique (campus_id, code)
);

create table public.floors (
  id uuid primary key default uuid_generate_v4(),
  building_id uuid not null references public.buildings(id),
  code text not null,
  name text not null,
  sort_order int not null default 0,
  unique (building_id, code)
);

create table public.systems (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  owner_role public.user_role not null default 'system_owner',
  description text,
  is_active boolean not null default true
);

create table public.room_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  is_teaching boolean not null default false,
  is_bookable boolean not null default false,
  is_specialist boolean not null default false,
  governance_risk text not null default 'standard'
);

create table public.room_patterns (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid references public.room_categories(id),
  name text not null unique,
  description text,
  default_booking_rules jsonb not null default '{}'::jsonb,
  default_o365_config jsonb not null default '{}'::jsonb,
  timetabling_eligible boolean not null default false,
  access_logic jsonb not null default '{}'::jsonb,
  required_attribute_keys text[] not null default '{}',
  approval_requirements jsonb not null default '[]'::jsonb,
  downstream_system_codes text[] not null default '{}'
);

create table public.rooms (
  id uuid primary key default uuid_generate_v4(),
  room_code text not null unique,
  name text not null,
  campus_id uuid not null references public.campuses(id),
  building_id uuid not null references public.buildings(id),
  floor_id uuid references public.floors(id),
  category_id uuid references public.room_categories(id),
  pattern_id uuid references public.room_patterns(id),
  capacity int check (capacity is null or capacity >= 0),
  owner text,
  booking_status text not null default 'not configured',
  is_bookable boolean not null default false,
  is_student_accessible boolean not null default false,
  is_staff_only boolean not null default false,
  is_archived boolean not null default false,
  physical_notes text,
  booking_notes text,
  data_quality_flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_attribute_definitions (
  id uuid primary key default uuid_generate_v4(),
  key text not null unique,
  label text not null,
  description text,
  type public.attribute_type not null,
  group_name text not null default 'General',
  options jsonb not null default '[]'::jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  is_required boolean not null default false,
  is_visible boolean not null default true,
  downstream_system_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.room_attribute_values (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  attribute_definition_id uuid not null references public.room_attribute_definitions(id),
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (room_id, attribute_definition_id)
);

create table public.system_mappings (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  system_id uuid not null references public.systems(id),
  external_id text,
  external_name text,
  mapping_status text not null default 'mapped',
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  unique (room_id, system_id)
);

create table public.transformation_rules (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  source_conditions jsonb not null,
  target_system_id uuid references public.systems(id),
  outputs jsonb not null,
  risk_level text not null default 'standard',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.change_requests (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.rooms(id),
  request_type text not null,
  title text not null,
  requested_change jsonb not null,
  reason text not null,
  impacted_system_codes text[] not null default '{}',
  status public.request_status not null default 'draft',
  requested_by uuid references public.profiles(id),
  current_approver_role public.user_role,
  risk_level text not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default uuid_generate_v4(),
  change_request_id uuid not null references public.change_requests(id) on delete cascade,
  stage int not null,
  approver_role public.user_role not null,
  approver_id uuid references public.profiles(id),
  decision text check (decision in ('pending', 'approved', 'rejected')) not null default 'pending',
  comments text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.implementation_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  request_type text,
  room_pattern_id uuid references public.room_patterns(id),
  system_codes text[] not null default '{}',
  tasks jsonb not null,
  runbook_links jsonb not null default '[]'::jsonb
);

create table public.implementation_tasks (
  id uuid primary key default uuid_generate_v4(),
  change_request_id uuid not null references public.change_requests(id) on delete cascade,
  title text not null,
  system_code text,
  owner_team text not null,
  due_date date,
  status public.implementation_status not null default 'not_started',
  depends_on uuid references public.implementation_tasks(id),
  completion_notes text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.room_change_log (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references public.rooms(id),
  change_request_id uuid references public.change_requests(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table public.import_jobs (
  id uuid primary key default uuid_generate_v4(),
  filename text not null,
  status public.import_status not null default 'draft',
  uploaded_by uuid references public.profiles(id),
  source_system text,
  original_file_path text,
  headers text[] not null default '{}',
  sample_rows jsonb not null default '[]'::jsonb,
  field_mapping jsonb not null default '{}'::jsonb,
  validation_summary jsonb not null default '{}'::jsonb,
  created_attribute_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.campuses enable row level security;
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.systems enable row level security;
alter table public.room_categories enable row level security;
alter table public.room_patterns enable row level security;
alter table public.rooms enable row level security;
alter table public.room_attribute_definitions enable row level security;
alter table public.room_attribute_values enable row level security;
alter table public.system_mappings enable row level security;
alter table public.transformation_rules enable row level security;
alter table public.change_requests enable row level security;
alter table public.approvals enable row level security;
alter table public.implementation_templates enable row level security;
alter table public.implementation_tasks enable row level security;
alter table public.room_change_log enable row level security;
alter table public.import_jobs enable row level security;

create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer'::public.user_role)
$$;

create policy "authenticated read reference data" on public.campuses for select to authenticated using (true);
create policy "authenticated read buildings" on public.buildings for select to authenticated using (true);
create policy "authenticated read floors" on public.floors for select to authenticated using (true);
create policy "authenticated read rooms" on public.rooms for select to authenticated using (true);
create policy "authenticated read room attrs" on public.room_attribute_definitions for select to authenticated using (true);
create policy "authenticated read room values" on public.room_attribute_values for select to authenticated using (true);
create policy "authenticated read room categories" on public.room_categories for select to authenticated using (true);
create policy "authenticated read room patterns" on public.room_patterns for select to authenticated using (true);
create policy "authenticated read systems" on public.systems for select to authenticated using (true);
create policy "authenticated read mappings" on public.system_mappings for select to authenticated using (true);
create policy "authenticated read rules" on public.transformation_rules for select to authenticated using (true);
create policy "authenticated read change requests" on public.change_requests for select to authenticated using (true);
create policy "authenticated read approvals" on public.approvals for select to authenticated using (true);
create policy "authenticated read tasks" on public.implementation_tasks for select to authenticated using (true);
create policy "authenticated read logs" on public.room_change_log for select to authenticated using (true);
create policy "authenticated read imports" on public.import_jobs for select to authenticated using (true);

create policy "editors manage rooms" on public.rooms for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "admins manage config" on public.room_attribute_definitions for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "editors manage values" on public.room_attribute_values for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "editors create requests" on public.change_requests for insert to authenticated
with check (public.current_user_role() in ('room_data_editor', 'system_owner', 'approver', 'admin'));

create policy "approvers update approvals" on public.approvals for update to authenticated
using (public.current_user_role() in ('approver', 'admin') or approver_id = auth.uid())
with check (public.current_user_role() in ('approver', 'admin') or approver_id = auth.uid());

create policy "admins manage imports" on public.import_jobs for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));
