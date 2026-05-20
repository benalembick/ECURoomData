revoke select on
  public.campuses,
  public.buildings,
  public.floors,
  public.room_categories,
  public.room_patterns,
  public.rooms,
  public.room_attribute_definitions,
  public.room_attribute_values,
  public.systems,
  public.system_mappings,
  public.transformation_rules
from anon;

drop policy if exists "public read active campuses" on public.campuses;
drop policy if exists "public read active buildings" on public.buildings;
drop policy if exists "public read floors" on public.floors;
drop policy if exists "public read room categories" on public.room_categories;
drop policy if exists "public read room patterns" on public.room_patterns;
drop policy if exists "public read active rooms" on public.rooms;
drop policy if exists "public read room attrs" on public.room_attribute_definitions;
drop policy if exists "public read room values" on public.room_attribute_values;
drop policy if exists "public read systems" on public.systems;
drop policy if exists "public read mappings" on public.system_mappings;
drop policy if exists "public read rules" on public.transformation_rules;

create policy "users read own profile" on public.profiles
for select to authenticated
using (id = auth.uid());

create policy "admins read profiles" on public.profiles
for select to authenticated
using (public.current_user_role() = 'admin');

create policy "admins insert profiles" on public.profiles
for insert to authenticated
with check (public.current_user_role() = 'admin');

create policy "admins update profiles" on public.profiles
for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');
