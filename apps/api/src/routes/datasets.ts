import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, db, get, now, run } from '../db.js';
import { HttpError, audit, parse } from '../lib/http.js';
import { detectKey, normalizeTin, readTable } from '../lib/table.js';

export const datasetsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

datasetsRouter.get('/', (_req, res) => {
  const rows = all<{ id: string; name: string; source_name: string | null; columns_json: string; rows_count: number; created_at: string }>(
    'SELECT * FROM datasets ORDER BY created_at DESC',
  );
  res.json({
    datasets: rows.map((row) => ({
      id: row.id,
      name: row.name,
      sourceName: row.source_name,
      columns: JSON.parse(row.columns_json) as string[],
      rowsCount: row.rows_count,
      createdAt: row.created_at,
    })),
  });
});

datasetsRouter.get('/:id', (req, res) => {
  const row = get<{ id: string; name: string; source_name: string | null; columns_json: string; rows_count: number; created_at: string }>(
    'SELECT * FROM datasets WHERE id = ?',
    req.params.id,
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ma’lumotlar to‘plami topilmadi.');

  const farms = all<{ tin: string; name: string }>("SELECT tin, name FROM farms WHERE status = 'active'");
  const values = all<{ farm_tin: string; variable: string }>(
    'SELECT DISTINCT farm_tin, variable FROM dataset_values WHERE dataset_id = ?',
    row.id,
  );
  const filled = new Set(values.map((value) => `${value.farm_tin}:${value.variable}`));
  const columns = JSON.parse(row.columns_json) as string[];

  const coverage = farms.map((farm) => ({
    tin: farm.tin,
    name: farm.name,
    missing: columns.filter((column) => !filled.has(`${farm.tin}:${column}`)),
  }));

  res.json({
    dataset: {
      id: row.id,
      name: row.name,
      sourceName: row.source_name,
      columns,
      rowsCount: row.rows_count,
      createdAt: row.created_at,
    },
    coverage,
  });
});

datasetsRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Fayl tanlanmagan.');
  const table = await readTable(req.file.buffer).catch(() => {
    throw new HttpError(400, 'BAD_FILE', 'Faylni o‘qib bo‘lmadi. Excel (.xlsx) yoki CSV yuklang.');
  });

  const tinColumn = detectKey(table.headers, [/stir/i, /стир/i, /^инн/i, /^inn/i, /^tin/i]);
  if (!tinColumn) throw new HttpError(400, 'NO_TIN', 'Faylda STIR ustuni topilmadi.');
  const columns = table.headers.filter((header) => header !== tinColumn);
  if (columns.length === 0) throw new HttpError(400, 'NO_COLUMNS', 'STIR’dan boshqa ustun yo‘q.');

  const id = crypto.randomUUID();
  const name = String((req.body as { name?: string }).name ?? '').trim() || req.file.originalname;
  const knownTins = new Set(all<{ tin: string }>('SELECT tin FROM farms').map((farm) => farm.tin));
  const seen = new Set<string>();
  const unknownTins: string[] = [];

  db.exec('BEGIN');
  try {
    run('INSERT INTO datasets (id, name, source_name, columns_json, rows_count, created_at) VALUES (?, ?, ?, ?, 0, ?)', id, name, req.file.originalname, JSON.stringify(columns), now());
    let inserted = 0;
    for (const row of table.rows) {
      const tin = normalizeTin(row[tinColumn] ?? '');
      if (tin.length !== 9 || seen.has(tin)) continue;
      seen.add(tin);
      if (!knownTins.has(tin)) unknownTins.push(tin);
      for (const column of columns) {
        const value = row[column] ?? '';
        if (value === '') continue;
        run('INSERT OR REPLACE INTO dataset_values (dataset_id, farm_tin, variable, value) VALUES (?, ?, ?, ?)', id, tin, column, value);
        inserted += 1;
      }
    }
    run('UPDATE datasets SET rows_count = ? WHERE id = ?', seen.size, id);
    db.exec('COMMIT');
    audit('buxgalter', 'dataset.imported', 'dataset', id, { rows: seen.size, columns: columns.length });
    res.status(201).json({
      dataset: { id, name, sourceName: req.file.originalname, columns, rowsCount: seen.size },
      unknownTins,
      preview: table.rows.slice(0, 5),
    });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

datasetsRouter.delete('/:id', (req, res) => {
  const row = get<{ id: string }>('SELECT id FROM datasets WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'To‘plam topilmadi.');
  run('DELETE FROM datasets WHERE id = ?', row.id);
  audit('buxgalter', 'dataset.deleted', 'dataset', row.id);
  res.json({ ok: true });
});

datasetsRouter.patch('/:id', (req, res) => {
  const row = get<{ id: string }>('SELECT id FROM datasets WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'To‘plam topilmadi.');
  const body = parse(z.object({ name: z.string().min(1) }), req.body);
  run('UPDATE datasets SET name = ? WHERE id = ?', body.name, row.id);
  res.json({ ok: true });
});
