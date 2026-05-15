create policy "editors write change log" on public.room_change_log for insert to authenticated
with check (public.current_user_role() in ('room_data_editor', 'admin'));

create policy "editors update import jobs" on public.import_jobs for update to authenticated
using (public.current_user_role() in ('room_data_editor', 'admin'))
with check (public.current_user_role() in ('room_data_editor', 'admin'));
