grant select on
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
to anon;

create policy "public read active campuses" on public.campuses
for select to anon
using (is_active = true);

create policy "public read active buildings" on public.buildings
for select to anon
using (is_active = true);

create policy "public read floors" on public.floors
for select to anon
using (true);

create policy "public read room categories" on public.room_categories
for select to anon
using (true);

create policy "public read room patterns" on public.room_patterns
for select to anon
using (true);

create policy "public read active rooms" on public.rooms
for select to anon
using (is_archived = false);

create policy "public read room attrs" on public.room_attribute_definitions
for select to anon
using (is_visible = true);

create policy "public read room values" on public.room_attribute_values
for select to anon
using (true);

create policy "public read systems" on public.systems
for select to anon
using (true);

create policy "public read mappings" on public.system_mappings
for select to anon
using (true);

create policy "public read rules" on public.transformation_rules
for select to anon
using (true);
