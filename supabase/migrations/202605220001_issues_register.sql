create table if not exists public.business_units (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  reference_colour text not null default '#0f766e',
  source_worksheet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issue_categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.issue_statuses (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  sort_order int not null default 0,
  is_closed boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.issues (
  id uuid primary key default uuid_generate_v4(),
  issue_id text not null,
  business_unit_id uuid not null references public.business_units(id),
  room_id uuid references public.rooms(id),
  room_code text,
  room_name text,
  date_identified date,
  contact_person text,
  issue_subject text,
  issue_detail text,
  priority text,
  source_category text,
  category_id uuid references public.issue_categories(id),
  responsible_person text,
  status_id uuid references public.issue_statuses(id),
  is_change_request boolean not null default false,
  photo_reference text,
  aconex_ref text,
  aconex_field_defect_number text,
  date_closed date,
  original_worksheet text not null,
  original_row_number int not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (original_worksheet, original_row_number)
);

create table if not exists public.issue_comments (
  id uuid primary key default uuid_generate_v4(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  comment_text text not null,
  author text not null,
  status_id uuid references public.issue_statuses(id),
  status_at_time text,
  created_at timestamptz not null default now()
);

create table if not exists public.issue_attachments_or_references (
  id uuid primary key default uuid_generate_v4(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  label text not null,
  url text,
  source_column text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists issues_business_unit_id_idx on public.issues (business_unit_id);
create index if not exists issues_issue_id_idx on public.issues (issue_id);
create index if not exists issues_room_code_idx on public.issues (room_code);
create index if not exists issues_status_id_idx on public.issues (status_id);
create index if not exists issues_category_id_idx on public.issues (category_id);
create index if not exists issues_is_change_request_idx on public.issues (is_change_request);

insert into public.issue_categories (name, sort_order)
values
  ('AV/IT', 10),
  ('Operations', 20),
  ('FFE', 30),
  ('Building Defect', 40),
  ('Change Request', 50),
  ('Other', 60)
on conflict (name) do update set sort_order = excluded.sort_order;

insert into public.issue_statuses (name, sort_order, is_closed)
values
  ('Open', 10, false),
  ('In-Progress', 20, false),
  ('Ready for User Inspection', 30, false),
  ('Closed', 40, true)
on conflict (name) do update set sort_order = excluded.sort_order, is_closed = excluded.is_closed;

alter table public.business_units enable row level security;
alter table public.issue_categories enable row level security;
alter table public.issue_statuses enable row level security;
alter table public.issues enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_attachments_or_references enable row level security;

create policy "authenticated read business units" on public.business_units for select to authenticated using (true);
create policy "authenticated read issue categories" on public.issue_categories for select to authenticated using (true);
create policy "authenticated read issue statuses" on public.issue_statuses for select to authenticated using (true);
create policy "authenticated read issues" on public.issues for select to authenticated using (true);
create policy "authenticated read issue comments" on public.issue_comments for select to authenticated using (true);
create policy "authenticated read issue references" on public.issue_attachments_or_references for select to authenticated using (true);

create policy "editors manage business units" on public.business_units for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "admins manage issue categories" on public.issue_categories for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "admins manage issue statuses" on public.issue_statuses for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "editors manage issues" on public.issues for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "editors manage issue comments" on public.issue_comments for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "editors manage issue references" on public.issue_attachments_or_references for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));
