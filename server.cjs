const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');
const { createClient } = require('@supabase/supabase-js');
const { handleBackupsApi } = require('./server-backups.cjs');

const port = process.env.PORT || 3000;
const distDir = path.join(__dirname, 'dist');
loadEnvFile();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function sendFile(response, filePath) {
  fs.readFile(filePath, function (error, contents) {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Server error');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    });
    response.end(contents);
  });
}

function sendNotFound(response) {
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function readJsonBody(request) {
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
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

async function requireAdmin(request) {
  if (!adminClient) {
    throw new Error('User management needs SUPABASE_SERVICE_ROLE_KEY on the server.');
  }

  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
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

async function handleUsersApi(request, response, pathname) {
  try {
    const currentAdmin = await requireAdmin(request);

    if (request.method === 'GET' && pathname === '/api/users') {
      const { data, error } = await adminClient
        .from('profiles')
        .select('id,email,display_name,role,business_unit,is_disabled,created_at')
        .order('display_name');

      if (error) throw error;
      sendJson(response, 200, { users: data || [] });
      return true;
    }

    if (request.method === 'POST' && pathname === '/api/users') {
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
      return true;
    }

    const userMatch = pathname.match(/^\/api\/users\/([0-9a-fA-F-]{36})$/);
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

      const authUpdates = {
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
      return true;
    }

    sendJson(response, 404, { error: 'API route not found.' });
    return true;
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'User management failed.' });
    return true;
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value) {
  if (value === 'room_data_editor' || value === 'admin') return value;
  return 'viewer';
}

http
  .createServer(function (request, response) {
    const parsedUrl = url.parse(request.url);
    const pathname = parsedUrl.pathname || '/';

    if (pathname.startsWith('/api/users')) {
      void handleUsersApi(request, response, pathname);
      return;
    }

    if (pathname.startsWith('/api/backups')) {
      void handleBackupsApi(request, response, adminClient, { mountPath: '/api/backups' });
      return;
    }

    const safePath = path
      .normalize(decodeURIComponent(pathname))
      .replace(/^(\.\.[/\\])+/, '');

    let filePath = path.join(distDir, safePath);

    if (safePath === '/' || !path.extname(filePath)) {
      filePath = path.join(distDir, 'index.html');
    }

    fs.stat(filePath, function (error, stats) {
      if (!error && stats.isFile()) {
        sendFile(response, filePath);
        return;
      }

      if (path.extname(filePath)) {
        sendNotFound(response);
        return;
      }

      sendFile(response, path.join(distDir, 'index.html'));
    });
  })
  .listen(port, function () {
    console.log('ECU Room Data Hub listening on port ' + port);
  });
