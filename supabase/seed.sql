insert into public.roles (name, description) values
  ('viewer', 'Can search and view room data.'),
  ('room_data_editor', 'Can propose and edit room data.'),
  ('system_owner', 'Owns downstream system mappings and implementation tasks.'),
  ('approver', 'Can approve governed room changes.'),
  ('admin', 'Can administer platform configuration and users.')
on conflict do nothing;

insert into public.campuses (code, name, address) values
  ('JO', 'Joondalup Campus', '270 Joondalup Drive, Joondalup WA'),
  ('ML', 'Mount Lawley Campus', '2 Bradford Street, Mount Lawley WA'),
  ('BU', 'Bunbury Campus', '585 Robertson Drive, Bunbury WA')
on conflict do nothing;

insert into public.buildings (campus_id, code, name, owner)
select c.id, b.code, b.name, b.owner
from public.campuses c
join (values
  ('JO', '31', 'Engineering and Technology', 'Campus Operations'),
  ('JO', '08', 'Library and Student Hub', 'Library Services'),
  ('ML', '10', 'WAAPA Music', 'WAAPA'),
  ('ML', '17', 'Teaching and Collaboration', 'Campus Operations'),
  ('BU', '03', 'Regional Teaching Building', 'Campus Operations')
) as b(campus_code, code, name, owner) on b.campus_code = c.code
on conflict do nothing;

insert into public.floors (building_id, code, name, sort_order)
select b.id, f.code, f.name, f.sort_order
from public.buildings b
join (values
  ('31', 'G', 'Ground', 0),
  ('31', '1', 'Level 1', 1),
  ('08', '2', 'Level 2', 2),
  ('10', 'G', 'Ground', 0),
  ('17', '1', 'Level 1', 1),
  ('03', '1', 'Level 1', 1)
) as f(building_code, code, name, sort_order) on f.building_code = b.code
on conflict do nothing;

insert into public.systems (code, name, description) values
  ('O365', 'Outlook/O365 Rooms', 'Exchange room mailbox and Room Finder configuration.'),
  ('ARCHIBUS', 'Archibus', 'Facilities room asset and space management records.'),
  ('TIMETABLING', 'Timetabling', 'Teaching allocation and scheduling eligibility.'),
  ('APPSPACE', 'Appspace', 'Room display and signage metadata.'),
  ('MOMENTUS', 'Momentus', 'External events and venue management.'),
  ('SECURITY', 'Security and Access Groups', 'Physical access and booking access groups.'),
  ('MAINTENANCE', 'Maintenance Systems', 'Maintenance asset and service ownership data.')
on conflict do nothing;

insert into public.room_categories (name, description, is_teaching, is_bookable, is_specialist, governance_risk) values
  ('Teaching Space', 'Centrally managed teaching and learning spaces.', true, true, false, 'high'),
  ('Meeting Room', 'Staff and business meeting spaces.', false, true, false, 'standard'),
  ('Student Collaboration', 'Student-accessible project and collaboration spaces.', false, true, false, 'high'),
  ('WAAPA Specialist', 'Specialist WAAPA spaces with equipment and access rules.', true, true, true, 'high'),
  ('Library Space', 'Library teaching and collaboration rooms.', true, true, false, 'standard'),
  ('Support Space', 'Non-bookable operational or support rooms.', false, false, false, 'standard')
on conflict do nothing;

insert into public.room_patterns (category_id, name, description, default_booking_rules, default_o365_config, timetabling_eligible, access_logic, required_attribute_keys, approval_requirements, downstream_system_codes)
select c.id, p.name, p.description, p.booking::jsonb, p.o365::jsonb, p.timetable, p.access::jsonb, p.required, p.approvals::jsonb, p.systems
from public.room_categories c
join (values
  ('Teaching Space', 'Standard Teaching Room', 'General purpose teaching space.', '{"staff_bookable": false, "student_bookable": false}', '{"room_finder_category": "Teaching"}', true, '{"staff": "timetabled", "students": "class enrolment"}', array['projector','lecture_capture'], '[{"stage":1,"role":"approver"},{"stage":2,"role":"system_owner"}]', array['O365','ARCHIBUS','TIMETABLING','APPSPACE','MAINTENANCE']),
  ('Teaching Space', 'TEAL Space', 'Technology enhanced active learning room.', '{"staff_bookable": false, "student_bookable": false}', '{"room_finder_category": "Teaching"}', true, '{"students": "class enrolment", "support": "AV escalation"}', array['teams_enabled','lecture_capture','specialist_equipment'], '[{"stage":1,"role":"approver"},{"stage":2,"role":"system_owner"}]', array['O365','ARCHIBUS','TIMETABLING','APPSPACE','MAINTENANCE']),
  ('Meeting Room', 'Meeting Room', 'Staff meeting room with optional O365 mailbox.', '{"staff_bookable": true, "student_bookable": false}', '{"room_finder_category": "Meeting"}', false, '{"staff": "all staff"}', array['teams_enabled'], '[{"stage":1,"role":"system_owner"}]', array['O365','ARCHIBUS','APPSPACE']),
  ('Student Collaboration', 'Student Project Room', 'Student project and workspace room.', '{"staff_bookable": true, "student_bookable": true}', '{"room_finder_category": "Workspace"}', false, '{"students": "student booking group"}', array['student_bookable'], '[{"stage":1,"role":"approver"},{"stage":2,"role":"system_owner"}]', array['O365','SECURITY','ARCHIBUS','APPSPACE']),
  ('WAAPA Specialist', 'Specialist WAAPA Space', 'Specialist creative production or practice space.', '{"staff_bookable": true, "student_bookable": false}', '{"room_finder_category": "Specialist"}', true, '{"students": "approved cohort", "staff": "WAAPA staff"}', array['specialist_equipment','student_access_group'], '[{"stage":1,"role":"approver"},{"stage":2,"role":"system_owner"}]', array['O365','ARCHIBUS','TIMETABLING','SECURITY','MAINTENANCE'])
) as p(category_name, name, description, booking, o365, timetable, access, required, approvals, systems) on p.category_name = c.name
on conflict do nothing;

insert into public.room_attribute_definitions (key, label, type, group_name, options, is_required, downstream_system_codes) values
  ('teams_enabled', 'Teams enabled', 'boolean', 'Booking and AV', '[]', false, array['O365','APPSPACE']),
  ('lecture_capture', 'Lecture capture', 'boolean', 'Teaching', '[]', false, array['TIMETABLING','APPSPACE']),
  ('projector', 'Projector', 'boolean', 'AV', '[]', false, array['TIMETABLING']),
  ('student_bookable', 'Student bookable', 'boolean', 'Booking', '[]', false, array['O365','SECURITY']),
  ('external_event_bookable', 'External event bookable', 'boolean', 'Booking', '[]', false, array['MOMENTUS']),
  ('specialist_equipment', 'Specialist equipment', 'multi_select', 'Equipment', '["Audio console","Broadcast camera","Practice piano","3D printer"]', false, array['TIMETABLING','MAINTENANCE']),
  ('student_access_group', 'Student access group', 'text', 'Security', '[]', false, array['SECURITY'])
on conflict do nothing;

insert into public.rooms (room_code, name, campus_id, building_id, floor_id, category_id, pattern_id, capacity, owner, booking_status, is_bookable, is_student_accessible, is_staff_only, physical_notes, booking_notes, data_quality_flags)
select r.room_code, r.name, c.id, b.id, f.id, cat.id, pat.id, r.capacity, r.owner, r.booking_status, r.is_bookable, r.is_student_accessible, r.is_staff_only, r.physical_notes, r.booking_notes, r.flags
from (values
  ('JO.31.101', 'Engineering TEAL Studio', 'JO', '31', '1', 'Teaching Space', 'TEAL Space', 48, 'Learning Environments', 'Tinetabled only', true, false, false, 'Flexible furniture, dual displays, AV support required.', 'O365 hidden from general booking; timetable controlled.', array['Missing Appspace verification']),
  ('JO.08.230', 'Library Teaching Lab', 'JO', '08', '2', 'Library Space', 'Standard Teaching Room', 32, 'Library Services', 'Bookable by staff', true, false, false, 'Teaching lab with library support desk nearby.', 'Staff requests via room booking process.', array[]::text[]),
  ('ML.10.G05', 'WAAPA Practice Room G05', 'ML', '10', 'G', 'WAAPA Specialist', 'Specialist WAAPA Space', 8, 'WAAPA', 'Restricted booking', true, true, false, 'Acoustic practice room with piano.', 'Student access limited to approved WAAPA cohorts.', array['Security group review required']),
  ('ML.17.112', 'Staff Collaboration 112', 'ML', '17', '1', 'Meeting Room', 'Meeting Room', 14, 'Digital Services', 'O365 visible to staff', true, false, true, 'Standard meeting room.', 'Staff can book through Outlook.', array[]::text[]),
  ('BU.03.104', 'Bunbury Student Project Room', 'BU', '03', '1', 'Student Collaboration', 'Student Project Room', 10, 'Student Life', 'Student bookable', true, true, false, 'Small project room for student groups.', 'Visible to students as workspace.', array[]::text[])
) as r(room_code, name, campus_code, building_code, floor_code, category_name, pattern_name, capacity, owner, booking_status, is_bookable, is_student_accessible, is_staff_only, physical_notes, booking_notes, flags)
join public.campuses c on c.code = r.campus_code
join public.buildings b on b.campus_id = c.id and b.code = r.building_code
left join public.floors f on f.building_id = b.id and f.code = r.floor_code
left join public.room_categories cat on cat.name = r.category_name
left join public.room_patterns pat on pat.name = r.pattern_name
on conflict do nothing;

insert into public.transformation_rules (name, description, source_conditions, target_system_id, outputs, risk_level)
select 'Student project room booking visibility',
  'Student project rooms with student booking enabled become student-visible O365 workspaces and require access group checks.',
  '{"room_pattern": "Student Project Room", "student_bookable": true}',
  s.id,
  '{"o365_visible_to_students": true, "security_group": "student booking group", "room_finder_category": "Workspace", "timetabling_eligible": false}',
  'high'
from public.systems s
where s.code = 'O365'
on conflict do nothing;
