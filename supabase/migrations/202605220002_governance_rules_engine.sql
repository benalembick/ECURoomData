-- Governance Request Types: named categories of change (rename, booking change, etc.)
create table if not exists public.governance_request_types (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  category text not null default 'General',
  risk_level text not null default 'standard' check (risk_level in ('standard', 'high', 'critical')),
  requires_room boolean not null default true,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Governance Systems: downstream systems that need action when room data changes
create table if not exists public.governance_systems (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  name text not null,
  description text,
  owner_team text not null default 'System Owner',
  system_type text not null default 'integration',
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- Governance Rules: when to trigger approvals, notifications, and task generation
create table if not exists public.governance_rules (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  request_type_id uuid references public.governance_request_types(id) on delete cascade,
  pattern_id uuid references public.room_patterns(id) on delete set null,
  applies_to text not null default 'all' check (applies_to in ('all', 'pattern', 'request_type')),
  risk_level text not null default 'standard' check (risk_level in ('standard', 'high', 'critical')),
  is_active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Governance Rule Conditions: attribute-based filters for when a rule fires
create table if not exists public.governance_rule_conditions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.governance_rules(id) on delete cascade,
  attribute_key text not null,
  operator text not null check (operator in ('equals', 'not_equals', 'contains', 'is_set', 'is_not_set', 'greater_than', 'less_than', 'in')),
  value text,
  sort_order int not null default 0
);

-- Governance Rule Actions: what happens when the rule fires
create table if not exists public.governance_rule_actions (
  id uuid primary key default uuid_generate_v4(),
  rule_id uuid not null references public.governance_rules(id) on delete cascade,
  action_type text not null check (action_type in ('require_approval', 'notify_system', 'set_risk', 'generate_template_tasks', 'flag_for_review')),
  target text,
  parameters jsonb not null default '{}'::jsonb,
  sort_order int not null default 0
);

-- Governance Templates: named sets of implementation tasks for a request type / pattern combo
create table if not exists public.governance_templates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  request_type_id uuid references public.governance_request_types(id) on delete set null,
  pattern_id uuid references public.room_patterns(id) on delete set null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Governance Template Tasks: individual action items within a template
create table if not exists public.governance_template_tasks (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid not null references public.governance_templates(id) on delete cascade,
  title text not null,
  system_id uuid references public.governance_systems(id) on delete set null,
  owner_team text not null default 'System Owner',
  estimated_days int not null default 2,
  instructions text,
  sort_order int not null default 0
);

-- Governance Pattern Config: per-pattern approval and system defaults
create table if not exists public.governance_pattern_config (
  id uuid primary key default uuid_generate_v4(),
  pattern_id uuid not null unique references public.room_patterns(id) on delete cascade,
  approval_stages jsonb not null default '[]'::jsonb,
  impacted_system_codes text[] not null default '{}',
  default_risk_level text not null default 'standard' check (default_risk_level in ('standard', 'high', 'critical')),
  notes text,
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists gov_rules_request_type_idx on public.governance_rules (request_type_id);
create index if not exists gov_rules_pattern_idx on public.governance_rules (pattern_id);
create index if not exists gov_rule_conditions_rule_idx on public.governance_rule_conditions (rule_id);
create index if not exists gov_rule_actions_rule_idx on public.governance_rule_actions (rule_id);
create index if not exists gov_template_tasks_template_idx on public.governance_template_tasks (template_id);

-- RLS
alter table public.governance_request_types enable row level security;
alter table public.governance_systems enable row level security;
alter table public.governance_rules enable row level security;
alter table public.governance_rule_conditions enable row level security;
alter table public.governance_rule_actions enable row level security;
alter table public.governance_templates enable row level security;
alter table public.governance_template_tasks enable row level security;
alter table public.governance_pattern_config enable row level security;

-- Read access: all authenticated users
create policy "authenticated read gov request types" on public.governance_request_types for select to authenticated using (true);
create policy "authenticated read gov systems" on public.governance_systems for select to authenticated using (true);
create policy "authenticated read gov rules" on public.governance_rules for select to authenticated using (true);
create policy "authenticated read gov rule conditions" on public.governance_rule_conditions for select to authenticated using (true);
create policy "authenticated read gov rule actions" on public.governance_rule_actions for select to authenticated using (true);
create policy "authenticated read gov templates" on public.governance_templates for select to authenticated using (true);
create policy "authenticated read gov template tasks" on public.governance_template_tasks for select to authenticated using (true);
create policy "authenticated read gov pattern config" on public.governance_pattern_config for select to authenticated using (true);

-- Write access: admins only
create policy "admins manage gov request types" on public.governance_request_types for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov systems" on public.governance_systems for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov rules" on public.governance_rules for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov rule conditions" on public.governance_rule_conditions for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov rule actions" on public.governance_rule_actions for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov templates" on public.governance_templates for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov template tasks" on public.governance_template_tasks for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

create policy "admins manage gov pattern config" on public.governance_pattern_config for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
