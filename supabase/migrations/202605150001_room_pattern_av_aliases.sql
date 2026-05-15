alter table public.room_patterns
  add column if not exists ecu_av_patterns text[] not null default '{}',
  add column if not exists vizcom_av_patterns text[] not null default '{}';

create policy "admins manage room patterns" on public.room_patterns for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

update public.room_patterns
set ecu_av_patterns = array['Standard Teaching', 'Standard Teaching Room', 'ECU Standard Teaching'],
    vizcom_av_patterns = array['STD-TEACH', 'Teaching Standard']
where name = 'Standard Teaching Room'
  and ecu_av_patterns = '{}'
  and vizcom_av_patterns = '{}';

update public.room_patterns
set ecu_av_patterns = array['TEAL', 'TEAL Space', 'Active Learning'],
    vizcom_av_patterns = array['TEAL', 'TEAL-AV', 'Active Learning Studio']
where name = 'TEAL Space'
  and ecu_av_patterns = '{}'
  and vizcom_av_patterns = '{}';

update public.room_patterns
set ecu_av_patterns = array['Meeting', 'Meeting Room', 'Teams Meeting'],
    vizcom_av_patterns = array['MEET', 'MTR Standard']
where name = 'Meeting Room'
  and ecu_av_patterns = '{}'
  and vizcom_av_patterns = '{}';

update public.room_patterns
set ecu_av_patterns = array['Student Project', 'Student Collaboration', 'Workspace'],
    vizcom_av_patterns = array['STUDENT-PROJECT', 'Workspace Display']
where name = 'Student Project Room'
  and ecu_av_patterns = '{}'
  and vizcom_av_patterns = '{}';

update public.room_patterns
set ecu_av_patterns = array['WAAPA Specialist', 'Practice Room', 'Specialist Creative'],
    vizcom_av_patterns = array['WAAPA-SPEC', 'Practice Room AV']
where name = 'Specialist WAAPA Space'
  and ecu_av_patterns = '{}'
  and vizcom_av_patterns = '{}';
