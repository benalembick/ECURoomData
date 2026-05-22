import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

type DatabaseRole = 'viewer' | 'room_data_editor' | 'admin';
type BackupApiHandler = (request: IncomingMessage, response: ServerResponse, adminClient: SupabaseClient | null, options?: { mountPath?: string }) => Promise<boolean>;

const require = createRequire(import.meta.url);
const { handleBackupsApi } = require('./server-backups.cjs') as { handleBackupsApi: BackupApiHandler };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const adminClient = supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  return {
    plugins: [
      react(),
      {
        name: 'room-data-user-api',
        configureServer(server) {
          server.middlewares.use('/api/users', async (request, response) => {
            await handleUsersApi(request, response, adminClient);
          });
          server.middlewares.use('/api/backups', async (request, response) => {
            await handleBackupsApi(request, response, adminClient, { mountPath: '/api/backups' });
          });
          // SPA fallback: rewrite any path without a file extension to index.html so
          // React handles routing, even when the path matches a real public/ directory.
          server.middlewares.use((request, _response, next) => {
            const url = (request.url ?? '/').split('?')[0];
            if (!url.startsWith('/api/') && !url.startsWith('/@') && !/\.[a-zA-Z0-9]+$/.test(url)) {
              request.url = '/index.html';
            }
            next();
          });
        },
      },
    ],
  };
});

async function handleUsersApi(request: IncomingMessage, response: ServerResponse, adminClient: SupabaseClient | null) {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const currentAdmin = await requireAdmin(request, adminClient);

    if (request.method === 'GET' && pathname === '/') {
      const { data, error } = await adminClient
        .from('profiles')
        .select('id,email,display_name,role,business_unit,is_disabled,created_at')
        .order('display_name');

      if (error) throw error;
      sendJson(response, 200, { users: data || [] });
      return;
    }

    if (request.method === 'POST' && pathname === '/') {
      const body = await readJsonBody(request);
      const email = cleanString(body.email).toLowerCase();
      const password = cleanString(body.password);
      const displayName = cleanString(body.displayName) || email;
      const role = normalizeRole(body.role);
      const isDisabled = Boolean(body.isDisabled);

      if (!email || !password) throw new Error('Email and password are required for new users.');

      const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        ban_duration: isDisabled ? '876000h' : 'none',
        user_metadata: { display_name: displayName },
      });

      if (authError || !authData.user) throw authError || new Error('Could not create user.');

      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email,
          display_name: displayName,
          role,
          is_disabled: isDisabled,
          business_unit: cleanString(body.businessUnit) || null,
        }, { onConflict: 'id' })
        .select('id,email,display_name,role,business_unit,is_disabled,created_at')
        .single();

      if (profileError) throw profileError;
      sendJson(response, 201, { user: profile });
      return;
    }

    const userMatch = pathname.match(/^\/([0-9a-fA-F-]{36})$/);
    if (request.method === 'PATCH' && userMatch) {
      const body = await readJsonBody(request);
      const id = userMatch[1];
      const isDisabled = Boolean(body.isDisabled);
      if (currentAdmin.id === id && isDisabled) throw new Error('You cannot disable your own admin account.');

      const updates = {
        display_name: cleanString(body.displayName),
        email: cleanString(body.email).toLowerCase(),
        role: normalizeRole(body.role),
        is_disabled: isDisabled,
        business_unit: cleanString(body.businessUnit) || null,
      };

      if (!updates.display_name || !updates.email) throw new Error('Display name and email are required.');

      const authUpdates: { email: string; password?: string; ban_duration: string; user_metadata: { display_name: string } } = {
        email: updates.email,
        ban_duration: isDisabled ? '876000h' : 'none',
        user_metadata: { display_name: updates.display_name },
      };
      const password = cleanString(body.password);
      if (password) authUpdates.password = password;

      const { error: authError } = await adminClient.auth.admin.updateUserById(id, authUpdates);
      if (authError) throw authError;

      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .update(updates)
        .eq('id', id)
        .select('id,email,display_name,role,business_unit,is_disabled,created_at')
        .single();

      if (profileError) throw profileError;
      sendJson(response, 200, { user: profile });
      return;
    }

    sendJson(response, 404, { error: 'API route not found.' });
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'User management failed.' });
  }
}

async function requireAdmin(request: IncomingMessage, adminClient: SupabaseClient | null) {
  if (!adminClient) {
    throw new Error('User management needs SUPABASE_SERVICE_ROLE_KEY in your .env file. Restart the dev server after adding it.');
  }

  const header = request.headers.authorization || '';
  const token = Array.isArray(header) ? '' : header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) throw new Error('Missing authorization token.');

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) throw new Error('Invalid authorization token.');

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin') {
    throw new Error('Only admins can manage users.');
  }

  return userData.user;
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value: unknown): DatabaseRole {
  if (value === 'room_data_editor' || value === 'admin') return value;
  return 'viewer';
}
