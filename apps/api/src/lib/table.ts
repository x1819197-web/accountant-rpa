import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

export interface ParsedTable {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export async function readTable(buffer: Buffer): Promise<ParsedTable> {
  const workbook = new ExcelJS.Workbook();
  if (buffer.subarray(0, 2).toString() === 'PK') {
    await workbook.xlsx.load(buffer as never);
  } else {
    await workbook.csv.read(Readable.from(buffer) as never);
  }
  return firstSheet(workbook);
}

function firstSheet(workbook: ExcelJS.Workbook): ParsedTable {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('EMPTY_WORKBOOK');

  let headerRowNumber = 1;
  let headers: string[] = [];
  for (let i = 1; i <= Math.min(sheet.rowCount, 10); i += 1) {
    const values = rowValues(sheet.getRow(i));
    if (values.filter(Boolean).length >= 2) {
      headerRowNumber = i;
      headers = values.map((value, index) => value || `ustun_${index + 1}`);
      break;
    }
  }
  if (headers.length === 0) throw new Error('NO_HEADER');

  const rows: Array<Record<string, string>> = [];
  for (let i = headerRowNumber + 1; i <= sheet.rowCount; i += 1) {
    const values = rowValues(sheet.getRow(i));
    if (values.every((value) => value === '')) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    rows.push(record);
  }

  return { headers, rows };
}

function rowValues(row: ExcelJS.Row): string[] {
  const raw = Array.isArray(row.values) ? row.values.slice(1) : [];
  return raw.map((value) => cellText(value as ExcelJS.CellValue));
}

function cellText(value: ExcelJS.CellValue | undefined | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'text' in value) return String((value as { text: string }).text).trim();
  if (typeof value === 'object' && 'result' in value) return cellText((value as { result: ExcelJS.CellValue }).result);
  return String(value).trim();
}

export function detectKey(headers: string[], candidates: RegExp[]): string | undefined {
  for (const candidate of candidates) {
    const found = headers.find((header) => candidate.test(header));
    if (found) return found;
  }
  return undefined;
}

export function normalizeTin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 9);
}
