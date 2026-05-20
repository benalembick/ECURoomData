import { supabase } from '../lib/supabase';
import type { DatabaseRole, UserProfile } from '../types';

interface DbProfile {
  id: string;
  email: string;
  display_name: string;
  role: DatabaseRole;
  business_unit: string | null;
  is_disabled?: boolean | null;
  created_at: string;
}

export interface SaveUserPayload {
  id?: string;
  email: string;
  displayName: string;
  role: DatabaseRole;
  businessUnit?: string;
  isDisabled?: boolean;
  password?: string;
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  if (!supabase) return null;

  const { data: userResponse, error: userError } = await supabase.auth.getUser();
  if (userError || !userResponse.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,role,business_unit,is_disabled,created_at')
    .eq('id', userResponse.user.id)
    .maybeSingle();

  if (error || !data) {
    return {
      id: userResponse.user.id,
      email: userResponse.user.email ?? '',
      displayName: userResponse.user.email ?? 'Signed-in user',
      role: 'viewer',
    };
  }

  return mapProfile(data as DbProfile);
}

export async function listUserProfiles(): Promise<UserProfile[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id,email,display_name,role,business_unit,is_disabled,created_at')
    .order('display_name');

  if (!error) return ((data ?? []) as DbProfile[]).map(mapProfile);

  const token = await getAccessToken();
  const response = await fetch('/api/users', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  return (payload.users as DbProfile[]).map(mapProfile);
}

export async function saveUserProfile(payload: SaveUserPayload): Promise<UserProfile> {
  const token = await getAccessToken();
  const response = await fetch(payload.id ? `/api/users/${payload.id}` : '/api/users', {
    method: payload.id ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse(response);
  return mapProfile(json.user as DbProfile);
}

async function getAccessToken() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Sign in as an admin before managing users.');
  return token;
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const responseText = await response.text();
  let payload: Record<string, unknown> = {};

  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : `The user management endpoint returned HTTP ${response.status}. Check that the app server is running and SUPABASE_SERVICE_ROLE_KEY is set.`,
    );
  }
  return payload;
}

function mapProfile(profile: DbProfile): UserProfile {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    businessUnit: profile.business_unit ?? undefined,
    isDisabled: Boolean(profile.is_disabled),
    createdAt: profile.created_at,
  };
}
