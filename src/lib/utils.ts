import { clsx, type ClassValue } from 'clsx';

export function cn(...values: ClassValue[]) {
  return clsx(values);
}

export function titleCase(value: string) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

export function downloadCsv(filename: string, rows: object[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ...rows.map((row) => {
      const record = row as Record<string, unknown>;
      return headers.map((header) => escape(record[header])).join(',');
    }),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
