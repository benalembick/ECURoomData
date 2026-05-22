import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  GovernanceRequestType,
  GovernanceRule,
  GovernanceRuleAction,
  GovernanceRuleCondition,
  GovernanceSystem,
  GovernanceTemplate,
  GovernanceTemplateTask,
  GovernancePatternConfig,
  RuleEvaluationContext,
  RuleEvaluationResult,
  DatabaseRole,
} from '../types';

// ─── DB shapes ──────────────────────────────────────────────────────────────

interface DbRequestType {
  id: string;
  name: string;
  description: string | null;
  category: string;
  risk_level: 'standard' | 'high' | 'critical';
  requires_room: boolean;
  sort_order: number;
  is_active: boolean;
}

interface DbSystem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  owner_team: string;
  system_type: string;
  is_active: boolean;
  sort_order: number;
}

interface DbRuleCondition {
  id: string;
  rule_id: string;
  attribute_key: string;
  operator: GovernanceRuleCondition['operator'];
  value: string | null;
  sort_order: number;
}

interface DbRuleAction {
  id: string;
  rule_id: string;
  action_type: GovernanceRuleAction['actionType'];
  target: string | null;
  parameters: Record<string, unknown>;
  sort_order: number;
}

interface DbRule {
  id: string;
  name: string;
  description: string | null;
  request_type_id: string | null;
  pattern_id: string | null;
  applies_to: 'all' | 'pattern' | 'request_type';
  risk_level: 'standard' | 'high' | 'critical';
  is_active: boolean;
  sort_order: number;
  governance_rule_conditions: DbRuleCondition[];
  governance_rule_actions: DbRuleAction[];
}

interface DbTemplateTask {
  id: string;
  template_id: string;
  title: string;
  system_id: string | null;
  owner_team: string;
  estimated_days: number;
  instructions: string | null;
  sort_order: number;
}

interface DbTemplate {
  id: string;
  name: string;
  request_type_id: string | null;
  pattern_id: string | null;
  description: string | null;
  is_active: boolean;
  governance_template_tasks: DbTemplateTask[];
}

interface DbPatternConfig {
  id: string;
  pattern_id: string;
  approval_stages: { role: DatabaseRole; label: string }[];
  impacted_system_codes: string[];
  default_risk_level: 'standard' | 'high' | 'critical';
  notes: string | null;
}

// ─── Loaders ────────────────────────────────────────────────────────────────

export async function loadGovernanceRequestTypes(): Promise<GovernanceRequestType[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('governance_request_types')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw new Error(`Could not load request types: ${error.message}`);
  return ((data ?? []) as DbRequestType[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    category: row.category,
    riskLevel: row.risk_level,
    requiresRoom: row.requires_room,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

export async function loadGovernanceSystems(): Promise<GovernanceSystem[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('governance_systems')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw new Error(`Could not load governance systems: ${error.message}`);
  return ((data ?? []) as DbSystem[]).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? undefined,
    ownerTeam: row.owner_team,
    systemType: row.system_type,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }));
}

export async function loadGovernanceRules(): Promise<GovernanceRule[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('governance_rules')
    .select(`
      id, name, description, request_type_id, pattern_id, applies_to, risk_level, is_active, sort_order,
      governance_rule_conditions(id, rule_id, attribute_key, operator, value, sort_order),
      governance_rule_actions(id, rule_id, action_type, target, parameters, sort_order)
    `)
    .order('sort_order');
  if (error) throw new Error(`Could not load governance rules: ${error.message}`);
  return ((data ?? []) as unknown as DbRule[]).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    requestTypeId: row.request_type_id ?? undefined,
    patternId: row.pattern_id ?? undefined,
    appliesTo: row.applies_to,
    riskLevel: row.risk_level,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    conditions: [...(row.governance_rule_conditions ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        id: c.id,
        ruleId: c.rule_id,
        attributeKey: c.attribute_key,
        operator: c.operator,
        value: c.value ?? undefined,
        sortOrder: c.sort_order,
      })),
    actions: [...(row.governance_rule_actions ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((a) => ({
        id: a.id,
        ruleId: a.rule_id,
        actionType: a.action_type,
        target: a.target ?? undefined,
        parameters: a.parameters,
        sortOrder: a.sort_order,
      })),
  }));
}

export async function loadGovernanceTemplates(): Promise<GovernanceTemplate[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('governance_templates')
    .select(`
      id, name, request_type_id, pattern_id, description, is_active,
      governance_template_tasks(id, template_id, title, system_id, owner_team, estimated_days, instructions, sort_order)
    `)
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(`Could not load governance templates: ${error.message}`);
  return ((data ?? []) as unknown as DbTemplate[]).map((row) => ({
    id: row.id,
    name: row.name,
    requestTypeId: row.request_type_id ?? undefined,
    patternId: row.pattern_id ?? undefined,
    description: row.description ?? undefined,
    isActive: row.is_active,
    tasks: [...(row.governance_template_tasks ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((t) => ({
        id: t.id,
        templateId: t.template_id,
        title: t.title,
        systemId: t.system_id ?? undefined,
        ownerTeam: t.owner_team,
        estimatedDays: t.estimated_days,
        instructions: t.instructions ?? undefined,
        sortOrder: t.sort_order,
      })),
  }));
}

export async function loadGovernancePatternConfigs(): Promise<GovernancePatternConfig[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase.from('governance_pattern_config').select('*');
  if (error) throw new Error(`Could not load pattern configs: ${error.message}`);
  return ((data ?? []) as DbPatternConfig[]).map((row) => ({
    id: row.id,
    patternId: row.pattern_id,
    approvalStages: Array.isArray(row.approval_stages) ? row.approval_stages : [],
    impactedSystemCodes: row.impacted_system_codes ?? [],
    defaultRiskLevel: row.default_risk_level,
    notes: row.notes ?? undefined,
  }));
}

// ─── Savers ─────────────────────────────────────────────────────────────────

export async function saveGovernanceRule(rule: Omit<GovernanceRule, 'conditions' | 'actions'>): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured.');
  const payload = {
    name: rule.name,
    description: rule.description ?? null,
    request_type_id: rule.requestTypeId ?? null,
    pattern_id: rule.patternId ?? null,
    applies_to: rule.appliesTo,
    risk_level: rule.riskLevel,
    is_active: rule.isActive,
    sort_order: rule.sortOrder,
    updated_at: new Date().toISOString(),
  };
  if (rule.id) {
    const { error } = await supabase.from('governance_rules').update(payload).eq('id', rule.id);
    if (error) throw new Error(`Could not update rule: ${error.message}`);
    return rule.id;
  }
  const { data, error } = await supabase.from('governance_rules').insert(payload).select('id').single();
  if (error) throw new Error(`Could not create rule: ${error.message}`);
  return (data as { id: string }).id;
}

export async function deleteGovernanceRule(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('governance_rules').delete().eq('id', id);
  if (error) throw new Error(`Could not delete rule: ${error.message}`);
}

export async function saveRuleConditionsAndActions(
  ruleId: string,
  conditions: Omit<GovernanceRuleCondition, 'id' | 'ruleId'>[],
  actions: Omit<GovernanceRuleAction, 'id' | 'ruleId'>[],
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error: delCond } = await supabase.from('governance_rule_conditions').delete().eq('rule_id', ruleId);
  if (delCond) throw new Error(`Could not replace conditions: ${delCond.message}`);
  const { error: delAct } = await supabase.from('governance_rule_actions').delete().eq('rule_id', ruleId);
  if (delAct) throw new Error(`Could not replace actions: ${delAct.message}`);
  if (conditions.length) {
    const { error } = await supabase.from('governance_rule_conditions').insert(
      conditions.map((c, i) => ({ rule_id: ruleId, attribute_key: c.attributeKey, operator: c.operator, value: c.value ?? null, sort_order: i })),
    );
    if (error) throw new Error(`Could not save conditions: ${error.message}`);
  }
  if (actions.length) {
    const { error } = await supabase.from('governance_rule_actions').insert(
      actions.map((a, i) => ({ rule_id: ruleId, action_type: a.actionType, target: a.target ?? null, parameters: a.parameters, sort_order: i })),
    );
    if (error) throw new Error(`Could not save actions: ${error.message}`);
  }
}

export async function saveGovernanceRequestType(
  rt: Omit<GovernanceRequestType, 'id'> & { id?: string },
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured.');
  const payload = {
    name: rt.name,
    description: rt.description ?? null,
    category: rt.category,
    risk_level: rt.riskLevel,
    requires_room: rt.requiresRoom,
    sort_order: rt.sortOrder,
    is_active: rt.isActive,
    updated_at: new Date().toISOString(),
  };
  if (rt.id) {
    const { error } = await supabase.from('governance_request_types').update(payload).eq('id', rt.id);
    if (error) throw new Error(`Could not update request type: ${error.message}`);
    return rt.id;
  }
  const { data, error } = await supabase.from('governance_request_types').insert(payload).select('id').single();
  if (error) throw new Error(`Could not create request type: ${error.message}`);
  return (data as { id: string }).id;
}

export async function deleteGovernanceRequestType(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('governance_request_types').delete().eq('id', id);
  if (error) throw new Error(`Could not delete request type: ${error.message}`);
}

export async function saveGovernanceSystem(
  system: Omit<GovernanceSystem, 'id'> & { id?: string },
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured.');
  const payload = {
    code: system.code.toUpperCase().trim(),
    name: system.name,
    description: system.description ?? null,
    owner_team: system.ownerTeam,
    system_type: system.systemType,
    is_active: system.isActive,
    sort_order: system.sortOrder,
  };
  if (system.id) {
    const { error } = await supabase.from('governance_systems').update(payload).eq('id', system.id);
    if (error) throw new Error(`Could not update system: ${error.message}`);
    return system.id;
  }
  const { data, error } = await supabase.from('governance_systems').insert(payload).select('id').single();
  if (error) throw new Error(`Could not create system: ${error.message}`);
  return (data as { id: string }).id;
}

export async function deleteGovernanceSystem(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('governance_systems').delete().eq('id', id);
  if (error) throw new Error(`Could not delete system: ${error.message}`);
}

export async function deleteGovernanceTemplate(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('governance_templates').delete().eq('id', id);
  if (error) throw new Error(`Could not delete template: ${error.message}`);
}

export async function saveChangeRequest(
  request: Omit<ChangeRequest, 'id'>,
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    return `CR-${Date.now()}`;
  }
  const statusMap: Record<string, string> = {
    'Draft': 'draft', 'Submitted': 'submitted', 'Under Review': 'under_review',
    'Awaiting Information': 'awaiting_information', 'Approved': 'approved',
    'Rejected': 'rejected', 'Ready for Implementation': 'ready_for_implementation',
    'Implemented': 'implemented', 'Verified': 'verified', 'Closed': 'closed',
  };
  const { data, error } = await supabase.from('change_requests').insert({
    title: request.title,
    request_type: request.requestType,
    reason: request.reason,
    requested_change: {},
    impacted_system_codes: request.impactedSystems,
    status: statusMap[request.status] ?? 'draft',
    risk_level: request.risk,
  }).select('id').single();
  if (error) throw new Error(`Could not save change request: ${error.message}`);
  return (data as { id: string }).id;
}

export async function saveGovernanceTemplate(template: Omit<GovernanceTemplate, 'tasks'>): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured.');
  const payload = {
    name: template.name,
    request_type_id: template.requestTypeId ?? null,
    pattern_id: template.patternId ?? null,
    description: template.description ?? null,
    is_active: template.isActive,
    updated_at: new Date().toISOString(),
  };
  if (template.id) {
    const { error } = await supabase.from('governance_templates').update(payload).eq('id', template.id);
    if (error) throw new Error(`Could not update template: ${error.message}`);
    return template.id;
  }
  const { data, error } = await supabase.from('governance_templates').insert(payload).select('id').single();
  if (error) throw new Error(`Could not create template: ${error.message}`);
  return (data as { id: string }).id;
}

export async function saveTemplateTask(task: Omit<GovernanceTemplateTask, 'id'> & { id?: string }): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase not configured.');
  const payload = {
    template_id: task.templateId,
    title: task.title,
    system_id: task.systemId ?? null,
    owner_team: task.ownerTeam,
    estimated_days: task.estimatedDays,
    instructions: task.instructions ?? null,
    sort_order: task.sortOrder,
  };
  if (task.id) {
    const { error } = await supabase.from('governance_template_tasks').update(payload).eq('id', task.id);
    if (error) throw new Error(`Could not update task: ${error.message}`);
    return task.id;
  }
  const { data, error } = await supabase.from('governance_template_tasks').insert(payload).select('id').single();
  if (error) throw new Error(`Could not create task: ${error.message}`);
  return (data as { id: string }).id;
}

export async function deleteTemplateTask(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.from('governance_template_tasks').delete().eq('id', id);
  if (error) throw new Error(`Could not delete task: ${error.message}`);
}

// ─── Rule evaluation engine ─────────────────────────────────────────────────

export function evaluateGovernanceRules(
  context: RuleEvaluationContext,
  rules: GovernanceRule[],
): RuleEvaluationResult {
  const matchedRules: GovernanceRule[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;

    // Filter by applies_to scope
    if (rule.appliesTo === 'request_type' && rule.requestTypeId !== context.requestTypeId) continue;
    if (rule.appliesTo === 'pattern' && rule.patternId !== context.patternId) continue;

    // Evaluate attribute conditions (AND logic)
    if (rule.conditions.length > 0) {
      const allConditionsMet = rule.conditions.every((condition) =>
        evaluateCondition(condition, context),
      );
      if (!allConditionsMet) continue;
    }

    matchedRules.push(rule);
  }

  // Aggregate actions from all matched rules
  const approvals = new Map<number, { role: DatabaseRole; label: string }>();
  const systemSet = new Set<string>();
  let riskLevel: 'standard' | 'high' | 'critical' = 'standard';
  let flaggedForReview = false;
  const templateIds: string[] = [];

  const riskRank: Record<string, number> = { standard: 0, high: 1, critical: 2 };

  for (const rule of matchedRules) {
    if (riskRank[rule.riskLevel] > riskRank[riskLevel]) {
      riskLevel = rule.riskLevel;
    }
    for (const action of rule.actions) {
      switch (action.actionType) {
        case 'require_approval': {
          const stage = (action.parameters.stage as number) ?? 1;
          if (!approvals.has(stage)) {
            approvals.set(stage, {
              role: (action.target ?? 'approver') as DatabaseRole,
              label: (action.parameters.label as string) ?? action.target ?? 'Approver',
            });
          }
          break;
        }
        case 'notify_system':
          if (action.target) systemSet.add(action.target);
          break;
        case 'set_risk': {
          const r = action.parameters.risk_level as 'standard' | 'high' | 'critical';
          if (r && riskRank[r] > riskRank[riskLevel]) riskLevel = r;
          break;
        }
        case 'flag_for_review':
          flaggedForReview = true;
          break;
        case 'generate_template_tasks':
          if (action.target) templateIds.push(action.target);
          break;
      }
    }
  }

  const requiredApprovals = Array.from(approvals.entries())
    .sort(([a], [b]) => a - b)
    .map(([stage, detail]) => ({ stage, ...detail }));

  return {
    matchedRules,
    requiredApprovals,
    impactedSystems: Array.from(systemSet),
    riskLevel,
    flaggedForReview,
    templateIds,
  };
}

function evaluateCondition(condition: GovernanceRuleCondition, context: RuleEvaluationContext): boolean {
  const attrs = { ...(context.room?.attributes ?? {}), ...(context.proposedAttributes ?? {}) };
  const rawValue = attrs[condition.attributeKey];
  const actualStr = String(rawValue ?? '').trim().toLowerCase();
  const expectedStr = (condition.value ?? '').trim().toLowerCase();

  switch (condition.operator) {
    case 'equals': return actualStr === expectedStr;
    case 'not_equals': return actualStr !== expectedStr;
    case 'contains': return actualStr.includes(expectedStr);
    case 'is_set': return rawValue !== undefined && rawValue !== null && rawValue !== '';
    case 'is_not_set': return rawValue === undefined || rawValue === null || rawValue === '';
    case 'greater_than': return parseFloat(actualStr) > parseFloat(expectedStr);
    case 'less_than': return parseFloat(actualStr) < parseFloat(expectedStr);
    case 'in': return expectedStr.split(',').map((v) => v.trim()).includes(actualStr);
    default: return false;
  }
}

// ─── Template instantiation ──────────────────────────────────────────────────

export function instantiateTemplateAsTasks(
  template: GovernanceTemplate,
  changeRequestId: string,
  startDate: Date = new Date(),
): { title: string; ownerTeam: string; dueDate: string; systemCode?: string; notes?: string }[] {
  let cursor = new Date(startDate);
  return template.tasks.map((task) => {
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + task.estimatedDays);
    return {
      title: task.title,
      ownerTeam: task.ownerTeam,
      dueDate: cursor.toISOString().split('T')[0],
      systemCode: task.systemId,
      notes: task.instructions ?? `Generated from template: ${template.name} (change request ${changeRequestId})`,
    };
  });
}
