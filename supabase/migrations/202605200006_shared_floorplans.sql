create table if not exists public.building_floorplans (
  id uuid primary key default uuid_generate_v4(),
  campus_code text not null,
  building_code text not null,
  building_name text,
  floor_label text not null,
  zone text not null check (zone in ('North', 'South', 'Both')),
  image_url text not null,
  image_storage_path text,
  source_pdf_url text,
  source_pdf_storage_path text,
  original_file_name text,
  source text not null default 'uploaded-pdf',
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_code, building_code, floor_label, zone)
);

create table if not exists public.building_floorplan_hotspots (
  id uuid primary key default uuid_generate_v4(),
  floorplan_id uuid not null references public.building_floorplans(id) on delete cascade,
  room_code text not null,
  room_name text,
  room_type text,
  shape text not null check (shape in ('rect', 'polygon')),
  points jsonb not null,
  sort_order int not null default 0
);

alter table public.building_floorplans enable row level security;
alter table public.building_floorplan_hotspots enable row level security;

grant select on public.building_floorplans, public.building_floorplan_hotspots to anon, authenticated;
grant insert, update, delete on public.building_floorplans, public.building_floorplan_hotspots to authenticated;

create policy "public read building floorplans" on public.building_floorplans
for select to anon, authenticated
using (true);

create policy "public read building floorplan hotspots" on public.building_floorplan_hotspots
for select to anon, authenticated
using (true);

create policy "editors manage building floorplans" on public.building_floorplans
for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "editors manage building floorplan hotspots" on public.building_floorplan_hotspots
for all to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));

insert into storage.buckets (id, name, public)
values ('building-floorplans', 'building-floorplans', true)
on conflict (id) do update set public = excluded.public;

create policy "public read building floorplan files" on storage.objects
for select to anon, authenticated
using (bucket_id = 'building-floorplans');

create policy "editors upload building floorplan files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'building-floorplans'
  and public.current_user_role() in ('room_data_editor', 'admin')
);

create policy "editors update building floorplan files" on storage.objects
for update to authenticated
using (
  bucket_id = 'building-floorplans'
  and public.current_user_role() in ('room_data_editor', 'admin')
)
with check (
  bucket_id = 'building-floorplans'
  and public.current_user_role() in ('room_data_editor', 'admin')
);

create policy "editors delete building floorplan files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'building-floorplans'
  and public.current_user_role() in ('room_data_editor', 'admin')
);
