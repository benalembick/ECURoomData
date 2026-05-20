alter table public.room_data_backup_rows
add column if not exists chunk_index int not null default 0;

alter table public.room_data_backup_rows
drop constraint if exists room_data_backup_rows_backup_set_id_table_name_key;

create unique index if not exists room_data_backup_rows_backup_set_table_chunk_key
on public.room_data_backup_rows (backup_set_id, table_name, chunk_index);

create or replace function public.backup_snapshot_rows(target_backup_id uuid, target_table_name text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(item.value order by backup_row.chunk_index, item.ordinality), '[]'::jsonb)
  from public.room_data_backup_rows backup_row
  cross join lateral jsonb_array_elements(backup_row.snapshot_rows) with ordinality as item(value, ordinality)
  where backup_row.backup_set_id = target_backup_id
    and backup_row.table_name = target_table_name
$$;

create or replace function public.restore_room_data_backup(target_backup_id uuid, restoring_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  table_rows jsonb;
begin
  if not exists (select 1 from public.room_data_backup_sets where id = target_backup_id) then
    raise exception 'Backup set % was not found.', target_backup_id;
  end if;

  delete from public.room_change_log;
  delete from public.approvals;
  delete from public.implementation_tasks;
  delete from public.change_requests;
  delete from public.room_attribute_values;
  delete from public.system_mappings;
  delete from public.rooms;
  delete from public.implementation_templates;
  delete from public.transformation_rules;
  delete from public.room_attribute_definitions;
  delete from public.room_patterns;
  delete from public.room_categories;
  delete from public.floors;
  delete from public.buildings;
  delete from public.campuses;
  delete from public.systems;
  delete from public.import_jobs;

  select public.backup_snapshot_rows(target_backup_id, 'campuses') into table_rows;
  if table_rows is not null then insert into public.campuses select * from jsonb_populate_recordset(null::public.campuses, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'buildings') into table_rows;
  if table_rows is not null then insert into public.buildings select * from jsonb_populate_recordset(null::public.buildings, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'floors') into table_rows;
  if table_rows is not null then insert into public.floors select * from jsonb_populate_recordset(null::public.floors, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'systems') into table_rows;
  if table_rows is not null then insert into public.systems select * from jsonb_populate_recordset(null::public.systems, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'room_categories') into table_rows;
  if table_rows is not null then insert into public.room_categories select * from jsonb_populate_recordset(null::public.room_categories, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'room_patterns') into table_rows;
  if table_rows is not null then insert into public.room_patterns select * from jsonb_populate_recordset(null::public.room_patterns, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'rooms') into table_rows;
  if table_rows is not null then insert into public.rooms select * from jsonb_populate_recordset(null::public.rooms, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'room_attribute_definitions') into table_rows;
  if table_rows is not null then insert into public.room_attribute_definitions select * from jsonb_populate_recordset(null::public.room_attribute_definitions, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'room_attribute_values') into table_rows;
  if table_rows is not null then insert into public.room_attribute_values select * from jsonb_populate_recordset(null::public.room_attribute_values, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'system_mappings') into table_rows;
  if table_rows is not null then insert into public.system_mappings select * from jsonb_populate_recordset(null::public.system_mappings, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'transformation_rules') into table_rows;
  if table_rows is not null then insert into public.transformation_rules select * from jsonb_populate_recordset(null::public.transformation_rules, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'change_requests') into table_rows;
  if table_rows is not null then insert into public.change_requests select * from jsonb_populate_recordset(null::public.change_requests, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'approvals') into table_rows;
  if table_rows is not null then insert into public.approvals select * from jsonb_populate_recordset(null::public.approvals, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'implementation_templates') into table_rows;
  if table_rows is not null then insert into public.implementation_templates select * from jsonb_populate_recordset(null::public.implementation_templates, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'implementation_tasks') into table_rows;
  if table_rows is not null then insert into public.implementation_tasks select * from jsonb_populate_recordset(null::public.implementation_tasks, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'room_change_log') into table_rows;
  if table_rows is not null then insert into public.room_change_log select * from jsonb_populate_recordset(null::public.room_change_log, table_rows); end if;

  select public.backup_snapshot_rows(target_backup_id, 'import_jobs') into table_rows;
  if table_rows is not null then insert into public.import_jobs select * from jsonb_populate_recordset(null::public.import_jobs, table_rows); end if;

  update public.room_data_backup_sets
  set restored_by = restoring_user_id,
      restored_at = now()
  where id = target_backup_id;
end;
$$;
