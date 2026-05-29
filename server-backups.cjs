// IMPORTANT: When adding a table here, also add it to restore_room_data_backup() in
// supabase/migrations/202605200005_room_attribute_groups.sql (the most recent version of that function),
// and keep RESTORE_TABLES below in sync. The startup check will warn if they diverge.
const BACKUP_TABLES = [
  'campuses',
  'buildings',
  'floors',
  'systems',
  'room_categories',
  'room_patterns',
  'rooms',
  'room_attribute_groups',
  'room_attribute_definitions',
  'room_attribute_values',
  'system_mappings',
  'transformation_rules',
  'change_requests',
  'approvals',
  'implementation_templates',
  'implementation_tasks',
  'room_change_log',
  'import_jobs',
];

// Must mirror the INSERT order in restore_room_data_backup() in
// supabase/migrations/202605200005_room_attribute_groups.sql.
const RESTORE_TABLES = [
  'campuses',
  'buildings',
  'floors',
  'systems',
  'room_categories',
  'room_patterns',
  'rooms',
  'room_attribute_groups',
  'room_attribute_definitions',
  'room_attribute_values',
  'system_mappings',
  'transformation_rules',
  'change_requests',
  'approvals',
  'implementation_templates',
  'implementation_tasks',
  'room_change_log',
  'import_jobs',
];

// Tables in the public schema that are intentionally excluded from backups.
// If a new table appears in the DB and is not in BACKUP_TABLES or here,
// checkForUncoveredTables() will log a warning.
const TABLES_NOT_BACKED_UP = new Set([
  'roles',                          // static role config, not room data
  'profiles',                       // user account data, not room data
  'room_data_backup_sets',          // backup infrastructure
  'room_data_backup_rows',          // backup infrastructure
  'building_floorplans',            // floorplan image metadata — intentionally excluded
  'building_floorplan_hotspots',    // floorplan room hotspots — intentionally excluded
  'business_units',                 // issues register — intentionally excluded
  'issue_categories',               // issues register — intentionally excluded
  'issue_statuses',                 // issues register — intentionally excluded
  'issues',                         // issues register — intentionally excluded
  'issue_comments',                 // issues register — intentionally excluded
  'issue_attachments_or_references', // issues register — intentionally excluded
  'governance_request_types',       // governance config — intentionally excluded
  'governance_systems',             // governance config — intentionally excluded
  'governance_rules',               // governance config — intentionally excluded
  'governance_rule_conditions',     // governance config — intentionally excluded
  'governance_rule_actions',        // governance config — intentionally excluded
  'governance_templates',           // governance config — intentionally excluded
  'governance_template_tasks',      // governance config — intentionally excluded
  'governance_pattern_config',      // governance config — intentionally excluded
]);

// Warn at startup if BACKUP_TABLES and RESTORE_TABLES have diverged.
(function validateTableLists() {
  const backupSet = new Set(BACKUP_TABLES);
  const restoreSet = new Set(RESTORE_TABLES);
  const missingFromRestore = BACKUP_TABLES.filter((t) => !restoreSet.has(t));
  const missingFromBackup = RESTORE_TABLES.filter((t) => !backupSet.has(t));
  if (missingFromRestore.length || missingFromBackup.length) {
    console.warn('[backup] BACKUP_TABLES and RESTORE_TABLES are out of sync!');
    if (missingFromRestore.length) console.warn('[backup]   In BACKUP_TABLES but not RESTORE_TABLES:', missingFromRestore.join(', '));
    if (missingFromBackup.length) console.warn('[backup]   In RESTORE_TABLES but not BACKUP_TABLES:', missingFromBackup.join(', '));
    console.warn('[backup]   Fix both server-backups.cjs and supabase/migrations/202605200005_room_attribute_groups.sql together.');
  }
})();

const BACKUP_PAGE_SIZE = 1000;
const BACKUP_CHUNK_SIZE = 500;
const backupOperations = new Map();
const OPERATION_TTL_MS = 30 * 60 * 1000;

async function handleBackupsApi(request, response, adminClient, options = {}) {
  try {
    const pathname = normalizeBackupPath(request.url || '/', options.mountPath || '/api/backups');
    const currentAdmin = await requireAdmin(request, adminClient);

    if (request.method === 'GET' && pathname === '/') {
      const { data, error } = await adminClient
        .from('room_data_backup_sets')
        .select('id,title,description,row_counts,total_rows,created_at,restored_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      sendJson(response, 200, { backups: data || [] });
      return true;
    }

    const operationMatch = pathname.match(/^\/operations\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && operationMatch) {
      const operation = backupOperations.get(operationMatch[1]);
      if (!operation) {
        sendJson(response, 404, { error: 'Backup operation was not found.' });
        return true;
      }

      sendJson(response, 200, { operation: publicOperation(operation) });
      return true;
    }

    if (request.method === 'POST' && pathname === '/') {
      const body = await readJsonBody(request);
      const title = cleanString(body.title) || `Room data backup ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Perth' })}`;
      const description = cleanString(body.description) || null;
      const operation = createOperation('backup', `Backing up ${title}`);
      backupOperations.set(operation.id, operation);
      void runBackupOperation(adminClient, currentAdmin.id, operation, title, description);
      sendJson(response, 202, { operation: publicOperation(operation) });
      return true;
    }

    const restoreMatch = pathname.match(/^\/([0-9a-fA-F-]{36})\/restore$/);
    if (request.method === 'POST' && restoreMatch) {
      const backupId = restoreMatch[1];
      const operation = createOperation('restore', 'Restoring backup set');
      operation.backupId = backupId;
      backupOperations.set(operation.id, operation);
      void runRestoreOperation(adminClient, currentAdmin.id, operation, backupId);
      sendJson(response, 202, { operation: publicOperation(operation) });
      return true;
    }

    const backupMatch = pathname.match(/^\/([0-9a-fA-F-]{36})$/);
    if (request.method === 'DELETE' && backupMatch) {
      const backupId = backupMatch[1];
      const { error } = await adminClient
        .from('room_data_backup_sets')
        .delete()
        .eq('id', backupId);

      if (error) throw error;
      sendJson(response, 200, { deletedId: backupId });
      return true;
    }

    sendJson(response, 404, { error: 'API route not found.' });
    return true;
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Backup management failed.' });
    return true;
  }
}

async function checkForUncoveredTables(adminClient) {
  try {
    const { data, error } = await adminClient
      .schema('information_schema')
      .from('tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .eq('table_type', 'BASE TABLE');

    if (error || !data) return;

    const backed = new Set(BACKUP_TABLES);
    const uncovered = data
      .map((r) => r.table_name)
      .filter((name) => !backed.has(name) && !TABLES_NOT_BACKED_UP.has(name))
      .sort();

    if (uncovered.length) {
      console.warn('[backup] Tables in the database not covered by backups:', uncovered.join(', '));
      console.warn('[backup]   Add them to BACKUP_TABLES (and the SQL restore function) or to TABLES_NOT_BACKED_UP if intentionally excluded.');
    }
  } catch {
    // Non-fatal — don't block the backup if information_schema is inaccessible.
  }
}

async function runBackupOperation(adminClient, currentAdminId, operation, title, description) {
  let backupSetId = null;

  try {
    await checkForUncoveredTables(adminClient);
    const rowCounts = {};
    const { data: backupSet, error: backupError } = await adminClient
      .from('room_data_backup_sets')
      .insert({
        title,
        description,
        row_counts: {},
        total_rows: 0,
        created_by: currentAdminId,
      })
      .select('id,title,description,row_counts,total_rows,created_at,restored_at')
      .single();

    if (backupError) throw backupError;
    backupSetId = backupSet.id;
    operation.backupId = backupSet.id;
    operation.message = 'Backup set created. Reading source tables.';

    for (const tableName of BACKUP_TABLES) {
      operation.currentTable = tableName;
      operation.message = `Backing up ${friendlyTableName(tableName)}`;
      rowCounts[tableName] = await writeBackupRowsForTable(adminClient, backupSet.id, tableName, operation);
      operation.completedTables += 1;
    }

    const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
    operation.message = 'Saving backup summary.';
    const { data: completedBackup, error: completeError } = await adminClient
      .from('room_data_backup_sets')
      .update({
        row_counts: rowCounts,
        total_rows: totalRows,
      })
      .eq('id', backupSet.id)
      .select('id,title,description,row_counts,total_rows,created_at,restored_at')
      .single();

    if (completeError) throw completeError;

    operation.status = 'completed';
    operation.message = `Backup complete: ${totalRows.toLocaleString()} rows captured.`;
    operation.backup = completedBackup;
    operation.completedAt = new Date().toISOString();
  } catch (error) {
    if (backupSetId) {
      await adminClient.from('room_data_backup_sets').delete().eq('id', backupSetId);
    }
    operation.status = 'failed';
    operation.error = error instanceof Error ? error.message : 'Backup failed.';
    operation.message = operation.error;
    operation.completedAt = new Date().toISOString();
  }
}

async function runRestoreOperation(adminClient, currentAdminId, operation, backupId) {
  try {
    operation.message = 'Restoring room data from selected backup.';
    operation.currentTable = 'restore';
    operation.completedTables = 0;
    const { error } = await adminClient.rpc('restore_room_data_backup', {
      target_backup_id: backupId,
      restoring_user_id: currentAdminId,
    });

    if (error) throw error;

    const { data, error: backupError } = await adminClient
      .from('room_data_backup_sets')
      .select('id,title,description,row_counts,total_rows,created_at,restored_at')
      .eq('id', backupId)
      .single();

    if (backupError) throw backupError;

    operation.completedTables = operation.totalTables;
    operation.status = 'completed';
    operation.message = 'Restore complete.';
    operation.backup = data;
    operation.completedAt = new Date().toISOString();
  } catch (error) {
    operation.status = 'failed';
    operation.error = error instanceof Error ? error.message : 'Restore failed.';
    operation.message = operation.error;
    operation.completedAt = new Date().toISOString();
  }
}

async function writeBackupRowsForTable(adminClient, backupSetId, tableName, operation) {
  let from = 0;
  let chunkIndex = 0;
  let rowCount = 0;

  while (true) {
    const to = from + BACKUP_PAGE_SIZE - 1;
    const { data, error } = await adminClient
      .from(tableName)
      .select('*')
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw new Error(`Could not read ${tableName}: ${error.message}`);

    const page = data || [];
    for (let index = 0; index < page.length; index += BACKUP_CHUNK_SIZE) {
      const chunk = page.slice(index, index + BACKUP_CHUNK_SIZE);
      const { error: insertError } = await adminClient
        .from('room_data_backup_rows')
        .insert({
          backup_set_id: backupSetId,
          table_name: tableName,
          chunk_index: chunkIndex,
          snapshot_rows: chunk,
          row_count: chunk.length,
        });

      if (insertError) throw new Error(`Could not write ${tableName} backup chunk ${chunkIndex}: ${insertError.message}`);
      chunkIndex += 1;
      rowCount += chunk.length;
      operation.currentTableRows = rowCount;
      operation.processedRows += chunk.length;
    }

    if (page.length < BACKUP_PAGE_SIZE) return rowCount;
    from += BACKUP_PAGE_SIZE;
  }
}

function createOperation(type, message) {
  cleanupOperations();
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    status: 'running',
    message,
    totalTables: type === 'backup' ? BACKUP_TABLES.length : 1,
    completedTables: 0,
    currentTable: '',
    currentTableRows: 0,
    processedRows: 0,
    createdAt: new Date().toISOString(),
  };
}

function publicOperation(operation) {
  const percent = operation.totalTables
    ? Math.min(99, Math.round((operation.completedTables / operation.totalTables) * 100))
    : 0;

  return {
    id: operation.id,
    type: operation.type,
    status: operation.status,
    message: operation.message,
    currentTable: operation.currentTable,
    currentTableRows: operation.currentTableRows,
    processedRows: operation.processedRows,
    completedTables: operation.completedTables,
    totalTables: operation.totalTables,
    percent: operation.status === 'completed' ? 100 : percent,
    error: operation.error,
    backup: operation.backup,
    backupId: operation.backupId,
    createdAt: operation.createdAt,
    completedAt: operation.completedAt,
  };
}

function cleanupOperations() {
  const cutoff = Date.now() - OPERATION_TTL_MS;
  for (const [id, operation] of backupOperations.entries()) {
    const completedAt = operation.completedAt ? Date.parse(operation.completedAt) : null;
    if (completedAt && completedAt < cutoff) backupOperations.delete(id);
  }
}

function friendlyTableName(tableName) {
  return tableName.replace(/_/g, ' ');
}

async function requireAdmin(request, adminClient) {
  if (!adminClient) {
    throw new Error('Backups need SUPABASE_SERVICE_ROLE_KEY on the server.');
  }

  const header = request.headers.authorization || '';
  const token = Array.isArray(header)
    ? ''
    : header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : '';
  if (!token) throw new Error('Missing authorization token.');

  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) throw new Error('Invalid authorization token.');

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileError || profile?.role !== 'admin') {
    throw new Error('Only admins can manage backups.');
  }

  return userData.user;
}

function normalizeBackupPath(requestUrl, mountPath) {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  if (pathname === mountPath) return '/';
  if (pathname.startsWith(`${mountPath}/`)) return pathname.slice(mountPath.length);
  return pathname || '/';
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  BACKUP_TABLES,
  handleBackupsApi,
};
