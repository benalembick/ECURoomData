create policy "admins manage campuses" on public.campuses for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "admins manage buildings" on public.buildings for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "admins manage floors" on public.floors for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');
