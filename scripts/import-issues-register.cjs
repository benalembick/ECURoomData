const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

const defaultWorkbook = 'C:/Users/balembic/Downloads/ECU Post Occupancy issues Register (1).xlsx';
const workbookPath = process.argv[2] || defaultWorkbook;
const outputPath = process.argv[3] || path.join(process.cwd(), 'src/data/issuesRegister.ts');
const assetOutputDir = path.join(process.cwd(), 'public/issue-assets');
const assetUrlPrefix = '/issue-assets';

const canonicalFields = {
  issueId: ['issue#', 'issueid', 'issuenumber', 'issueno', 'issueno#'],
  dateIdentified: ['dateidentified', 'dateidentifiedreported', 'identifieddate'],
  contactPerson: ['contactperson', 'contact', 'raisedby', 'requestor'],
  roomCode: ['roomnumber', 'roomno', 'roomcode'],
  roomName: ['roomname', 'roomdescription'],
  subject: ['issuesubject', 'subject', 'title'],
  detail: ['issuedetaildescription', 'issuedetail', 'description', 'details'],
  priority: ['priority', 'priorityrefertoprioritiesguidetabinspreadsheetfordefinitions'],
  photoReference: ['photo', 'photos', 'photorequiredforalldefectsinsertphotoorlink', 'photolink', 'photoreference'],
  sourceCategory: ['category', 'type'],
  responsiblePerson: ['responsible', 'responsibility', 'responsibleperson'],
  commentary: ['commentaryupdate', 'commentary', 'update', 'comments'],
  aconexRef: ['aconexref', 'aconexreference'],
  aconexFieldDefect: ['aconexfielddefect', 'aconexfielddefectnumber', 'aconexfielddefect#'],
  status: ['status'],
  dateClosed: ['dateclosed', 'closeddate'],
};

const excludedSheets = new Set(['Priorities Guide', 'List']);
const fallbackColours = [
  '#d92d20', '#7f56d9', '#1570ef', '#12b76a', '#f79009', '#0e9384',
  '#dd2590', '#667085', '#175cd3', '#039855', '#b42318', '#6941c6',
  '#b54708', '#0086c9', '#5925dc', '#027a48', '#c11574',
];

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, 'and')
    .replace(/[^a-zA-Z0-9#]+/g, '')
    .toLowerCase();
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

function decodeXml(value) {
  return cleanText(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function safeDecodeUri(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function sanitizeFilePart(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'asset';
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeDate(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  const text = cleanText(value);
  if (!text) return '';
  const dayMonthYear = text.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/);
  if (dayMonthYear) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = monthNames.indexOf(dayMonthYear[2].slice(0, 3).toLowerCase()) + 1;
    const yearNumber = Number(dayMonthYear[3]);
    const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
    if (month > 0) return formatDateParts(year, month, Number(dayMonthYear[1]));
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatDateParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  return text;
}

function normalizeStatus(value) {
  const text = cleanText(value).toLowerCase();
  if (!text) return 'Open';
  if (text.includes('ready') || text.includes('inspection')) return 'Ready for User Inspection';
  if (text.includes('progress')) return 'In-Progress';
  if (text.includes('closed') || text.includes('complete')) return 'Closed';
  if (text.includes('open')) return 'Open';
  return cleanText(value);
}

function normalizeCategory(category, subject, detail) {
  const source = cleanText(category).toLowerCase();
  if (source) {
    if (source.includes('change request') || source.includes('variation')) return 'Change Request';
    if (/\bav\b/.test(source) || /\bit\b/.test(source) || source.includes('digital')) return 'AV/IT';
    if (source.includes('furniture') || source.includes('fittings') || source.includes('ffe') || source.includes('joinery')) return 'FFE';
    if (source.includes('building') || source.includes('architectural') || source.includes('defect') || source.includes('maintenance')) return 'Building Defect';
    if (source.includes('operational') || source.includes('operations') || source.includes('facilities') || source.includes('physical move')) return 'Operations';
  }

  const text = `${subject} ${detail}`.toLowerCase();
  if (text.includes('change request') || text.includes('variation')) return 'Change Request';
  if (/\bav\b/.test(text) || /\bit\b/.test(text) || text.includes('digital') || text.includes('compute') || text.includes('cctv')) return 'AV/IT';
  if (text.includes('furniture') || text.includes('fittings') || text.includes('ffe') || text.includes('joinery')) return 'FFE';
  if (text.includes('building') || text.includes('architectural') || text.includes('defect') || text.includes('maintenance')) return 'Building Defect';
  if (text.includes('operational') || text.includes('operations') || text.includes('facilities') || text.includes('physical move')) return 'Operations';
  return 'Other';
}

function isChangeRequest(category, subject, detail) {
  return `${category} ${subject} ${detail}`.toLowerCase().includes('change request')
    || normalizeCategory(category, subject, detail) === 'Change Request';
}

function findHeaderRow(rows) {
  let best = { index: -1, score: 0 };
  rows.forEach((row, index) => {
    const normalized = row.map(normalizeHeader).filter(Boolean);
    const score = Object.values(canonicalFields)
      .filter((aliases) => aliases.some((alias) => normalized.some((header) => header.includes(alias) || alias.includes(header))))
      .length;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : -1;
}

function mapHeaders(headers) {
  const byIndex = new Map();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    for (const [field, aliases] of Object.entries(canonicalFields)) {
      if (aliases.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized))) {
        if (![...byIndex.values()].includes(field)) byIndex.set(index, field);
        return;
      }
    }
  });
  return byIndex;
}

function getCellValue(ws, rowIndex, colIndex) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = ws[address];
  if (!cell) return '';
  return cleanText(cell.w ?? cell.v);
}

function getCellHyperlink(ws, rowIndex, colIndex) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = ws[address];
  return decodeXml(cell?.l?.Target || cell?.l?.display || '');
}

function parseRelationships(xml) {
  const relationships = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = match[1];
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] ?? '';
    if (id && target) relationships.set(id, { target: decodeXml(target), type });
  }
  return relationships;
}

function resolvePackagePath(basePartPath, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(basePartPath), target));
}

function getWorkbookSharePointBase(zip) {
  const workbookXml = zip.readAsText('xl/workbook.xml');
  return decodeXml(workbookXml.match(/<x15ac:absPath[^>]*url="([^"]+)"/)?.[1] ?? '');
}

function getWorkbookSheets(zip) {
  const workbookXml = zip.readAsText('xl/workbook.xml');
  const workbookRels = parseRelationships(zip.readAsText('xl/_rels/workbook.xml.rels'));
  const sheets = new Map();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const sheetName = decodeXml(match[1]);
    const relationship = workbookRels.get(match[2]);
    if (!relationship) continue;
    sheets.set(sheetName, resolvePackagePath('xl/workbook.xml', relationship.target));
  }
  return sheets;
}

function worksheetRelsPath(worksheetPath) {
  return `${path.posix.dirname(worksheetPath)}/_rels/${path.posix.basename(worksheetPath)}.rels`;
}

function saveAssetBuffer(buffer, filename) {
  fs.mkdirSync(assetOutputDir, { recursive: true });
  const safeName = sanitizeFilePart(filename);
  fs.writeFileSync(path.join(assetOutputDir, safeName), buffer);
  return `${assetUrlPrefix}/${safeName}`;
}

function copyLocalAsset(filePath, filenamePrefix) {
  const decoded = safeDecodeUri(filePath.replace(/^file:\/+/i, ''));
  const windowsPath = decoded.replace(/^([A-Za-z]):[\\/]/, '$1:/').replace(/\//g, path.sep);
  const candidates = [
    windowsPath,
    path.join(path.dirname(workbookPath), decoded),
  ];
  const existing = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!existing) return '';
  const ext = path.extname(existing) || '.jpg';
  return saveAssetBuffer(fs.readFileSync(existing), `${filenamePrefix}${ext}`);
}

function canonicalizePhotoTarget(target, sharePointBaseUrl) {
  const cleaned = decodeXml(target);
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  if (/^file:\/+/i.test(cleaned)) return cleaned;

  const sharePointOrigin = sharePointBaseUrl ? new URL(encodeURI(sharePointBaseUrl)).origin : 'https://edithcowanuni.sharepoint.com';
  const officeSharingPath = cleaned.replace(/^(\.\.\/)+/, '');
  if (/^:[a-z]:\/[a-z]\//i.test(officeSharingPath)) return `${sharePointOrigin}/${officeSharingPath}`;

  if (sharePointBaseUrl) {
    try {
      return new URL(cleaned, encodeURI(sharePointBaseUrl)).toString();
    } catch {
      return cleaned;
    }
  }

  return cleaned;
}

function extractEmbeddedImageAttachments(zip) {
  const attachmentsBySheetRow = new Map();
  const workbookSheets = getWorkbookSheets(zip);

  for (const [sheetName, worksheetPath] of workbookSheets) {
    const relsPath = worksheetRelsPath(worksheetPath);
    const relsEntry = zip.getEntry(relsPath);
    if (!relsEntry) continue;

    const worksheetXml = zip.readAsText(worksheetPath);
    const drawingRid = worksheetXml.match(/<drawing[^>]*r:id="([^"]+)"/)?.[1];
    if (!drawingRid) continue;

    const worksheetRels = parseRelationships(zip.readAsText(relsPath));
    const drawingRelationship = worksheetRels.get(drawingRid);
    if (!drawingRelationship) continue;

    const drawingPath = resolvePackagePath(worksheetPath, drawingRelationship.target);
    const drawingRelsPath = `${path.posix.dirname(drawingPath)}/_rels/${path.posix.basename(drawingPath)}.rels`;
    if (!zip.getEntry(drawingPath) || !zip.getEntry(drawingRelsPath)) continue;

    const drawingXml = zip.readAsText(drawingPath);
    const drawingRels = parseRelationships(zip.readAsText(drawingRelsPath));
    const anchorRegex = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<a:blip[^>]*r:embed="([^"]+)"[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;

    for (const match of drawingXml.matchAll(anchorRegex)) {
      const colIndex = Number(match[1]);
      const rowNumber = Number(match[2]) + 1;
      const relationship = drawingRels.get(match[3]);
      if (!relationship || !relationship.type.includes('/image')) continue;

      const mediaPath = resolvePackagePath(drawingPath, relationship.target);
      const mediaEntry = zip.getEntry(mediaPath);
      if (!mediaEntry) continue;

      const ext = path.extname(mediaPath) || '.png';
      const url = saveAssetBuffer(mediaEntry.getData(), `${sheetName}-row-${rowNumber}-col-${colIndex + 1}-${path.basename(mediaPath, ext)}${ext}`);
      const rowKey = `${sheetName}:${rowNumber}`;
      const existing = attachmentsBySheetRow.get(rowKey) ?? [];
      existing.push({
        label: `Embedded photo ${existing.length + 1}`,
        url,
        sourceColumn: `Embedded workbook image, column ${XLSX.utils.encode_col(colIndex)}`,
      });
      attachmentsBySheetRow.set(rowKey, existing);
    }
  }

  return attachmentsBySheetRow;
}

function extractTabColours(xlsxPath) {
  const zip = new AdmZip(xlsxPath);
  const workbookXml = zip.readAsText('xl/workbook.xml');
  const relsXml = zip.readAsText('xl/_rels/workbook.xml.rels');
  const rels = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((match) => [match[1], match[2]]));
  const colours = new Map();

  for (const match of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = match[1].replace(/&amp;/g, '&');
    const target = rels.get(match[2]);
    if (!target) continue;
    const worksheetPath = `xl/${target.replace(/^\//, '')}`.replace(/xl\/xl\//, 'xl/');
    const xml = zip.readAsText(worksheetPath);
    const rgb = xml.match(/<tabColor[^>]*rgb="([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6})"/)?.[1];
    if (rgb) colours.set(name, `#${rgb.slice(-6)}`);
  }
  return colours;
}

if (fs.existsSync(assetOutputDir)) {
  fs.rmSync(assetOutputDir, { recursive: true, force: true });
}

const workbookZip = new AdmZip(workbookPath);
const workbookSharePointBaseUrl = getWorkbookSharePointBase(workbookZip);
const embeddedImageAttachments = extractEmbeddedImageAttachments(workbookZip);
const tabColours = extractTabColours(workbookPath);
const workbook = XLSX.readFile(workbookPath, { cellDates: true, cellStyles: true });
const units = [];
const issues = [];
const attachments = [];
let fallbackColourIndex = 0;

for (const sheetName of workbook.SheetNames) {
  if (excludedSheets.has(sheetName)) continue;
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false, defval: '' });
  const headerIndex = findHeaderRow(rows);
  if (headerIndex < 0) continue;

  const headers = rows[headerIndex].map(cleanText);
  const headerMap = mapHeaders(headers);
  const colour = tabColours.get(sheetName) || fallbackColours[fallbackColourIndex++ % fallbackColours.length];
  const unitId = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  units.push({ id: unitId, name: sheetName, colour });

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const hasContent = row.some((value) => cleanText(value));
    if (!hasContent) continue;

    const record = {};
    const metadata = {};
    headers.forEach((header, colIndex) => {
      if (!header) return;
      const value = getCellValue(ws, rowIndex, colIndex);
      if (!value) return;
      const field = headerMap.get(colIndex);
      if (field) record[field] = value;
      else metadata[header] = value;
    });

    const issueIdText = cleanText(record.issueId);
    const hasIssueBody = [
      record.dateIdentified,
      record.contactPerson,
      record.roomCode,
      record.roomName,
      record.subject,
      record.detail,
      record.priority,
      record.photoReference,
      record.sourceCategory,
      record.responsiblePerson,
      record.commentary,
      record.aconexRef,
      record.aconexFieldDefect,
      record.status,
      record.dateClosed,
      ...Object.values(metadata),
    ].some((value) => cleanText(value));

    if (!issueIdText && !record.subject && !record.detail && !record.roomCode) continue;
    if (issueIdText.toLowerCase() === 'example') continue;
    if (issueIdText.toLowerCase().replace(/\s+/g, '') === 'issue#') continue;
    if (issueIdText && !hasIssueBody) continue;

    const photoColumnIndex = [...headerMap.entries()].find(([, field]) => field === 'photoReference')?.[0];
    const rawPhotoLink = photoColumnIndex == null ? '' : getCellHyperlink(ws, rowIndex, photoColumnIndex);
    const photoLink = canonicalizePhotoTarget(rawPhotoLink, workbookSharePointBaseUrl);
    const sourceCategory = cleanText(record.sourceCategory);
    const subject = cleanText(record.subject);
    const detail = cleanText(record.detail);
    const category = normalizeCategory(sourceCategory, subject, detail);
    const id = `${unitId}-${rowIndex + 1}-${cleanText(record.issueId || subject || record.roomCode).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const issue = {
      id,
      issueId: issueIdText || `${sheetName}-${rowIndex + 1}`,
      businessUnitId: unitId,
      businessUnitName: sheetName,
      businessUnitColour: colour,
      originalWorksheet: sheetName,
      originalRowNumber: rowIndex + 1,
      dateIdentified: normalizeDate(record.dateIdentified),
      contactPerson: cleanText(record.contactPerson),
      roomCode: cleanText(record.roomCode),
      roomName: cleanText(record.roomName),
      subject,
      detail,
      priority: cleanText(record.priority),
      photoReference: cleanText(record.photoReference),
      sourceCategory,
      category,
      isChangeRequest: isChangeRequest(sourceCategory, subject, detail),
      responsiblePerson: cleanText(record.responsiblePerson),
      status: normalizeStatus(record.status),
      dateClosed: normalizeDate(record.dateClosed),
      aconexRef: cleanText(record.aconexRef),
      aconexFieldDefect: cleanText(record.aconexFieldDefect),
      metadata,
      comments: [],
    };

    const commentary = cleanText(record.commentary);
    if (commentary) {
      issue.comments.push({
        id: `${id}-comment-1`,
        issueId: id,
        text: commentary,
        author: 'Spreadsheet import',
        createdAt: new Date().toISOString(),
        statusAtTime: issue.status,
      });
    }

    issues.push(issue);

    const embeddedAttachments = embeddedImageAttachments.get(`${sheetName}:${rowIndex + 1}`) ?? [];
    embeddedAttachments.forEach((attachment, index) => {
      attachments.push({
        id: `${id}-embedded-${index + 1}`,
        issueId: id,
        ...attachment,
      });
    });

    if (issue.photoReference || photoLink) {
      const localPhotoUrl = rawPhotoLink && (/^file:\/+/i.test(rawPhotoLink) || /\.(png|jpe?g|gif|webp)(?:$|[?#])/i.test(rawPhotoLink))
        ? copyLocalAsset(rawPhotoLink, `${id}-linked-photo`)
        : '';
      attachments.push({
        id: `${id}-reference-1`,
        issueId: id,
        label: issue.photoReference || 'Photo/reference',
        url: localPhotoUrl || photoLink,
        sourceUrl: localPhotoUrl && photoLink ? photoLink : undefined,
        sourceColumn: 'Photo/Link',
      });
    }
  }
}

const categories = ['AV/IT', 'Operations', 'FFE', 'Building Defect', 'Change Request', 'Other'];
const statuses = ['Open', 'In-Progress', 'Ready for User Inspection', 'Closed'];

const file = `import type { BusinessUnit, Issue, IssueAttachmentReference, IssueCategory, IssueStatus } from '../types';

export const issueBusinessUnits: BusinessUnit[] = ${JSON.stringify(units, null, 2)};

export const issueCategories: IssueCategory[] = ${JSON.stringify(categories.map((name, index) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sortOrder: index })), null, 2)};

export const issueStatuses: IssueStatus[] = ${JSON.stringify(statuses.map((name, index) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sortOrder: index })), null, 2)};

export const issueAttachmentReferences: IssueAttachmentReference[] = ${JSON.stringify(attachments, null, 2)};

export const importedIssues: Issue[] = ${JSON.stringify(issues, null, 2)};

export const issuesImportSummary = {
  sourceWorkbook: ${JSON.stringify(path.basename(workbookPath))},
  importedAt: ${JSON.stringify(new Date().toISOString())},
  issueCount: ${issues.length},
  businessUnitCount: ${units.length},
};
`;

fs.writeFileSync(outputPath, file);
console.log(`Imported ${issues.length} issues from ${units.length} worksheets into ${outputPath}`);
