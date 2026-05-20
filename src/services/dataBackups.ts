import { supabase } from '../lib/supabase';

export interface DataBackupSet {
  id: string;
  title: string;
  description?: string;
  rowCounts: Record<string, number>;
  totalRows: number;
  createdAt: string;
  restoredAt?: string;
}

export interface BackupOperation {
  id: string;
  type: 'backup' | 'restore';
  status: 'running' | 'completed' | 'failed';
  message: string;
  currentTable?: string;
  currentTableRows?: number;
  processedRows?: number;
  completedTables: number;
  totalTables: number;
  percent: number;
  error?: string;
  backup?: DataBackupSet;
  backupId?: string;
}

interface DbBackupSet {
  id: string;
  title: string;
  description: string | null;
  row_counts: Record<string, number> | null;
  total_rows: number;
  created_at: string;
  restored_at: string | null;
}

interface DbBackupOperation {
  id: string;
  type: 'backup' | 'restore';
  status: 'running' | 'completed' | 'failed';
  message: string;
  currentTable?: string;
  currentTableRows?: number;
  processedRows?: number;
  completedTables: number;
  totalTables: number;
  percent: number;
  error?: string;
  backup?: DbBackupSet;
  backupId?: string;
}

export async function listDataBackups(): Promise<DataBackupSet[]> {
  const token = await getAccessToken();
  const response = await fetch('/api/backups', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  return ((payload.backups as DbBackupSet[]) ?? []).map(mapBackupSet);
}

export async function createDataBackup(title: string, description?: string): Promise<BackupOperation> {
  const token = await getAccessToken();
  const response = await fetch('/api/backups', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, description }),
  });

  const payload = await parseJsonResponse(response);
  return mapOperation(payload.operation as DbBackupOperation);
}

export async function restoreDataBackup(id: string): Promise<BackupOperation> {
  const token = await getAccessToken();
  const response = await fetch(`/api/backups/${id}/restore`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  return mapOperation(payload.operation as DbBackupOperation);
}

export async function getBackupOperation(id: string): Promise<BackupOperation> {
  const token = await getAccessToken();
  const response = await fetch(`/api/backups/operations/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  return mapOperation(payload.operation as DbBackupOperation);
}

export async function deleteDataBackup(id: string): Promise<string> {
  const token = await getAccessToken();
  const response = await fetch(`/api/backups/${id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await parseJsonResponse(response);
  return String(payload.deletedId ?? id);
}

async function getAccessToken() {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('Sign in as an admin before managing backups.');
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
        : `The backup endpoint returned HTTP ${response.status}. Check that the app server is running and SUPABASE_SERVICE_ROLE_KEY is set.`,
    );
  }
  return payload;
}

function mapBackupSet(backup: DbBackupSet): DataBackupSet {
  return {
    id: backup.id,
    title: backup.title,
    description: backup.description ?? undefined,
    rowCounts: backup.row_counts ?? {},
    totalRows: backup.total_rows,
    createdAt: backup.created_at,
    restoredAt: backup.restored_at ?? undefined,
  };
}

function mapOperation(operation: DbBackupOperation): BackupOperation {
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
    percent: operation.percent,
    error: operation.error,
    backup: operation.backup ? mapBackupSet(operation.backup) : undefined,
    backupId: operation.backupId,
  };
}
