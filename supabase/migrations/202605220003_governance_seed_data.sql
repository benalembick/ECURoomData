-- Governance seed data: MVP patterns for ECU City Campus

-- Request types
insert into public.governance_request_types (name, description, category, risk_level, sort_order) values
  ('Room Rename', 'Update the official name of a room without changing its physical configuration.', 'Room Attributes', 'standard', 10),
  ('Capacity Change', 'Change the seating or occupancy capacity for a room.', 'Room Attributes', 'standard', 20),
  ('Booking Configuration Change', 'Enable, disable, or modify booking system configuration (O365, Appspace, Momentus).', 'Booking Configuration', 'high', 30),
  ('Pattern / Use Change', 'Change the room pattern (e.g. teaching → meeting) which affects downstream systems.', 'Lifecycle', 'high', 40),
  ('AV / IT Configuration', 'Update AV or IT equipment configuration recorded against the room.', 'Room Attributes', 'standard', 50),
  ('Access Change', 'Modify access control settings, key holder groups, or after-hours access.', 'Access', 'high', 60),
  ('New Room Commissioning', 'Onboard a new room into the data hub and connected systems.', 'Lifecycle', 'critical', 70),
  ('Room Decommission', 'Archive a room and remove it from active bookings and downstream systems.', 'Lifecycle', 'critical', 80),
  ('Timetabling Eligibility Change', 'Add or remove a room from the timetabling pool.', 'Booking Configuration', 'high', 90),
  ('System Mapping Update', 'Update the external identifier linking this room to a downstream system.', 'Integration', 'standard', 100)
on conflict (name) do update set
  description = excluded.description,
  category = excluded.category,
  risk_level = excluded.risk_level,
  sort_order = excluded.sort_order;

-- Governance systems
insert into public.governance_systems (code, name, description, owner_team, system_type, sort_order) values
  ('O365', 'Microsoft 365 / Exchange', 'Room mailbox creation, booking policies, and calendar configuration.', 'Digital Services', 'booking', 10),
  ('APPSPACE', 'Appspace', 'Digital signage and room display panel configuration.', 'AV & Venues', 'signage', 20),
  ('MOMENTUS', 'Momentus (EMS)', 'Event management system used for venue bookings.', 'Venue Management', 'booking', 30),
  ('TIMETABLING', 'Timetabling (EST)', 'Academic timetabling system controlling room pool allocations.', 'Student Administration', 'timetabling', 40),
  ('HECTOR', 'Hector', 'Asset tracking and equipment management.', 'IT Services', 'asset', 50),
  ('ARCHIBUS', 'Archibus / FM', 'Facilities management and space inventory.', 'Facilities Management', 'facilities', 60),
  ('ACCESS_CTRL', 'Access Control', 'Physical security, card access, and after-hours entry.', 'Security', 'access', 70),
  ('ICELAB', 'ICELab', 'Specialised learning space management for active classrooms.', 'Learning Environments', 'specialist', 80)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  owner_team = excluded.owner_team,
  system_type = excluded.system_type,
  sort_order = excluded.sort_order;

-- Governance rules: TEAL Space (bookable teaching space)
-- Rule 1: Booking config change on a TEAL Space requires approver + Digital Services + AV
insert into public.governance_rules (name, description, applies_to, risk_level, sort_order)
select
  'TEAL Space — Booking Change',
  'Any booking configuration change to a TEAL teaching space requires Approver-level sign-off and Digital Services notification.',
  'request_type',
  'high',
  10
where not exists (select 1 from public.governance_rules where name = 'TEAL Space — Booking Change');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'require_approval', 'approver', '{"stage": 1, "label": "AV & Venues Team Lead"}'::jsonb, 1
from public.governance_rules r where r.name = 'TEAL Space — Booking Change'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'require_approval' and a.target = 'approver');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'notify_system', 'O365', '{"reason": "Room mailbox policy must be updated"}'::jsonb, 2
from public.governance_rules r where r.name = 'TEAL Space — Booking Change'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'notify_system' and a.target = 'O365');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'notify_system', 'APPSPACE', '{"reason": "Room display panel must be reconfigured"}'::jsonb, 3
from public.governance_rules r where r.name = 'TEAL Space — Booking Change'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'notify_system' and a.target = 'APPSPACE');

-- Rule 2: New Room Commissioning is critical — multi-stage approval
insert into public.governance_rules (name, description, applies_to, risk_level, sort_order)
select
  'New Room Commissioning — Multi-Stage Approval',
  'Commissioning a new room requires two approval stages (Room Data Editor then Admin) and triggers all major downstream systems.',
  'request_type',
  'critical',
  20
where not exists (select 1 from public.governance_rules where name = 'New Room Commissioning — Multi-Stage Approval');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'require_approval', 'room_data_editor', '{"stage": 1, "label": "Room Data Custodian"}'::jsonb, 1
from public.governance_rules r where r.name = 'New Room Commissioning — Multi-Stage Approval'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.target = 'room_data_editor');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'require_approval', 'admin', '{"stage": 2, "label": "Data Hub Administrator"}'::jsonb, 2
from public.governance_rules r where r.name = 'New Room Commissioning — Multi-Stage Approval'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.target = 'admin');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'set_risk', null, '{"risk_level": "critical"}'::jsonb, 3
from public.governance_rules r where r.name = 'New Room Commissioning — Multi-Stage Approval'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'set_risk');

-- Rule 3: Pattern / Use Change always escalates to admin
insert into public.governance_rules (name, description, applies_to, risk_level, sort_order)
select
  'Pattern Change — Admin Escalation',
  'Changing a room pattern has wide downstream impact and requires administrator approval.',
  'request_type',
  'high',
  30
where not exists (select 1 from public.governance_rules where name = 'Pattern Change — Admin Escalation');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'require_approval', 'admin', '{"stage": 1, "label": "Data Hub Administrator"}'::jsonb, 1
from public.governance_rules r where r.name = 'Pattern Change — Admin Escalation'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'require_approval');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'flag_for_review', null, '{"reason": "Pattern changes affect timetabling eligibility and all booking systems"}'::jsonb, 2
from public.governance_rules r where r.name = 'Pattern Change — Admin Escalation'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id and a.action_type = 'flag_for_review');

-- Rule 4: Decommission requires admin + notifies all systems
insert into public.governance_rules (name, description, applies_to, risk_level, sort_order)
select
  'Room Decommission — Full Review',
  'Decommissioning a room requires administrator approval and removal from all downstream systems.',
  'request_type',
  'critical',
  40
where not exists (select 1 from public.governance_rules where name = 'Room Decommission — Full Review');

insert into public.governance_rule_actions (rule_id, action_type, target, parameters, sort_order)
select r.id, 'require_approval', 'admin', '{"stage": 1, "label": "Data Hub Administrator"}'::jsonb, 1
from public.governance_rules r where r.name = 'Room Decommission — Full Review'
and not exists (select 1 from public.governance_rule_actions a where a.rule_id = r.id);

-- Implementation template: Booking Configuration Change
insert into public.governance_templates (name, description)
select 'Booking Configuration Change — Standard', 'Tasks for updating room booking settings across O365, Appspace, and the data hub.'
where not exists (select 1 from public.governance_templates where name = 'Booking Configuration Change — Standard');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Update Room Mailbox Policy in O365/Exchange', 'Digital Services', 2,
  'Open Exchange Admin Centre → Resources → Room mailboxes. Locate the room and update the booking policy (capacity, booking window, auto-accept rules) as per the approved change request.',
  10
from public.governance_templates t where t.name = 'Booking Configuration Change — Standard'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Update Room Mailbox Policy in O365/Exchange');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Update Appspace Room Display Panel', 'AV & Venues', 1,
  'Log into Appspace portal → Room configuration. Update the room name, capacity, and booking calendar source to reflect the change.',
  20
from public.governance_templates t where t.name = 'Booking Configuration Change — Standard'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Update Appspace Room Display Panel');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Verify booking end-to-end in production', 'Digital Services', 1,
  'Make a test booking via Outlook or the Appspace panel. Confirm the room accepts and declines bookings according to the new policy.',
  30
from public.governance_templates t where t.name = 'Booking Configuration Change — Standard'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Verify booking end-to-end in production');

-- Implementation template: New Room Commissioning
insert into public.governance_templates (name, description)
select 'New Room Commissioning — Full Onboarding', 'Complete task list to bring a new room live across all downstream systems.'
where not exists (select 1 from public.governance_templates where name = 'New Room Commissioning — Full Onboarding');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Create room record in Data Hub', 'Room Data Team', 1,
  'Enter the room in the ECU Room Data Hub with all required attributes: code, name, capacity, pattern, floor, and booking eligibility flags.',
  10
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Create room record in Data Hub');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Create O365 Room Mailbox', 'Digital Services', 2,
  'Using the Exchange Admin Centre, create a new room mailbox. Set capacity, booking window, and auto-accept policy. Link to the room''s Data Hub record.',
  20
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Create O365 Room Mailbox');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Add room to Appspace scheduling', 'AV & Venues', 2,
  'Register the room display panel in Appspace and assign the O365 calendar feed. Test the panel shows live booking data.',
  30
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Add room to Appspace scheduling');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Register in Archibus / FM space inventory', 'Facilities Management', 3,
  'Add the space to Archibus with correct floor, area, and category. Assign to cost centre and responsible team.',
  40
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Register in Archibus / FM space inventory');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Configure access control', 'Security', 3,
  'Program card access rules for the room. Add to appropriate access groups and confirm after-hours policy.',
  50
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Configure access control');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Final sign-off and go-live notification', 'Room Data Team', 1,
  'Complete the checklist in the Data Hub change request, mark as Verified, and notify stakeholders that the room is now live.',
  60
from public.governance_templates t where t.name = 'New Room Commissioning — Full Onboarding'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Final sign-off and go-live notification');

-- Implementation template: Timetabling Eligibility Change
insert into public.governance_templates (name, description)
select 'Timetabling Eligibility Change', 'Tasks for adding or removing a room from the academic timetabling pool.'
where not exists (select 1 from public.governance_templates where name = 'Timetabling Eligibility Change');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Update timetabling eligibility flag in Data Hub', 'Room Data Team', 1,
  'Set the is_teaching_space attribute and timetabling room pool code in the room record.',
  10
from public.governance_templates t where t.name = 'Timetabling Eligibility Change'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Update timetabling eligibility flag in Data Hub');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Update room pool in timetabling system (EST)', 'Student Administration', 2,
  'Add or remove the room from the relevant GTS/STS/RTS pool in the timetabling system. Confirm enrolment periods are not affected.',
  20
from public.governance_templates t where t.name = 'Timetabling Eligibility Change'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Update room pool in timetabling system (EST)');

insert into public.governance_template_tasks (template_id, title, owner_team, estimated_days, instructions, sort_order)
select t.id, 'Update O365 room pool identifier in mailbox name', 'Digital Services', 1,
  'If the GTS/STS/RTS code is embedded in the O365 display name, update the Exchange mailbox name to reflect the new pool designation.',
  30
from public.governance_templates t where t.name = 'Timetabling Eligibility Change'
and not exists (select 1 from public.governance_template_tasks tt where tt.template_id = t.id and tt.title = 'Update O365 room pool identifier in mailbox name');
