import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { AttributeDefinition, AttributeGroup } from '../types';

export async function createAttributeGroup(name: string): Promise<AttributeGroup> {
  if (!isSupabaseConfigured || !supabase) return { name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('room_attribute_groups')
    .upsert({ name, updated_at: now }, { onConflict: 'name' })
    .select('name,description,sort_order,created_at,updated_at')
    .single();

  if (error) throw new Error(`Could not create ${name}: ${error.message}`);
  return mapAttributeGroup(data);
}

export async function renameAttributeGroup(previousName: string, nextName: string, fields: AttributeDefinition[]): Promise<AttributeGroup> {
  if (!isSupabaseConfigured || !supabase) return { name: nextName, updatedAt: new Date().toISOString() };

  const now = new Date().toISOString();
  const { data, error: groupError } = await supabase
    .from('room_attribute_groups')
    .upsert({ name: nextName, updated_at: now }, { onConflict: 'name' })
    .select('name,description,sort_order,created_at,updated_at')
    .single();
  if (groupError) throw new Error(`Could not rename ${previousName}: ${groupError.message}`);

  const { error: fieldError } = await supabase
    .from('room_attribute_definitions')
    .update({ group_name: nextName, updated_at: now })
    .eq('group_name', previousName);
  if (fieldError) throw new Error(`Could not move fields from ${previousName}: ${fieldError.message}`);

  await deleteAttributeGroup(previousName, []);
  await Promise.all(fields.map((field) => persistAttributeDefinitionGroup({ ...field, group: nextName, updatedAt: now })));
  return mapAttributeGroup(data);
}

export async function deleteAttributeGroup(name: string, fields: AttributeDefinition[]): Promise<void> {
  if (fields.length) throw new Error(`Move ${fields.length} field${fields.length === 1 ? '' : 's'} out of ${name} before deleting it.`);
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from('room_attribute_groups')
    .delete()
    .eq('name', name);
  if (error) throw new Error(`Could not delete ${name}: ${error.message}`);
}

export async function moveAttributeDefinitionsToGroup(fields: AttributeDefinition[], group: string): Promise<AttributeDefinition[]> {
  const now = new Date().toISOString();
  const updatedFields = fields.map((field) => ({ ...field, group, updatedAt: now }));
  await Promise.all(updatedFields.map(persistAttributeDefinitionGroup));
  return updatedFields;
}

export async function persistAttributeDefinitionGroup(attribute: AttributeDefinition) {
  if (!isSupabaseConfigured || !supabase) return;

  const { error } = await supabase
    .from('room_attribute_definitions')
    .upsert({
      key: attribute.key,
      label: attribute.label,
      description: attribute.description ?? null,
      type: toDatabaseAttributeType(attribute.type),
      group_name: attribute.group,
      options: attribute.options ?? [],
      is_required: attribute.required,
      is_visible: attribute.visible,
      downstream_system_codes: attribute.downstreamSystems,
      updated_at: attribute.updatedAt ?? new Date().toISOString(),
    }, { onConflict: 'key' });

  if (error) throw new Error(`Could not save ${attribute.label}: ${error.message}`);
}

function mapAttributeGroup(group: {
  name: string;
  description?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}): AttributeGroup {
  return {
    name: group.name,
    description: group.description ?? undefined,
    sortOrder: group.sort_order ?? undefined,
    createdAt: group.created_at ?? undefined,
    updatedAt: group.updated_at ?? undefined,
  };
}

function toDatabaseAttributeType(type: AttributeDefinition['type']) {
  if (type === 'multi-select') return 'multi_select';
  if (type === 'system reference') return 'system_reference';
  return type;
}
