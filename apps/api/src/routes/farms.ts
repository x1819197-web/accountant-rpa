import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, get, now, run } from '../db.js';
import { HttpError, audit, parse } from '../lib/http.js';
import { parsePfx } from '../lib/keys.js';
import { decrypt, encrypt, type AuthedRequest } from '../lib/security.js';
import { detectKey, normalizeTin, readTable } from '../lib/table.js';

export const farmsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

interface FarmRow {
  id: string;
  name: string;
  tin: string;
  group_name: string | null;
  note: string | null;
  status: 'active' | 'archived';
  key_subject: string | null;
  key_tin: string | null;
  key_valid_to: string | null;
  key_attached_at: string | null;
  one_c_url: string | null;
  consent_at: string | null;
  created_at: string;
  updated_at: string;
}

const farmSchema = z.object({
  name: z.string().min(2, 'Nom kamida 2 belgi'),
  tin: z.string().regex(/^\d{9}$/, 'STIR 9 raqamdan iborat'),
  groupName: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
  oneCUrl: z.string().url().optional().or(z.literal('')),
});

function keyStatus(farm: FarmRow): { status: 'missing' | 'expired' | 'expiring' | 'ok'; daysLeft: number | null } {
  if (!farm.key_valid_to) return { status: 'missing', daysLeft: null };
  const daysLeft = Math.ceil((new Date(farm.key_valid_to).getTime() - Date.now()) / 86_400_000);
  if (daysLeft < 0) return { status: 'expired', daysLeft };
  if (daysLeft <= 30) return { status: 'expiring', daysLeft };
  return { status: 'ok', daysLeft };
}

function farmView(row: FarmRow, credentials?: unknown[]) {
  const key = keyStatus(row);
  return {
    id: row.id,
    name: row.name,
    tin: row.tin,
    groupName: row.group_name,
    note: row.note,
    status: row.status,
    oneCUrl: row.one_c_url,
    consentAt: row.consent_at,
    key: {
      attached: Boolean(row.key_valid_to),
      subject: row.key_subject,
      tin: row.key_tin,
      validTo: row.key_valid_to,
      attachedAt: row.key_attached_at,
      status: key.status,
      daysLeft: key.daysLeft,
      tinMismatch: Boolean(row.key_tin && row.key_tin !== row.tin),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(credentials ? { credentials } : {}),
  };
}

farmsRouter.get('/', (req, res) => {
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const status = String(req.query.status ?? 'active');
  const group = String(req.query.group ?? '').trim();

  const rows = all<FarmRow>(
    `SELECT * FROM farms
     WHERE (? = 'all' OR status = ?)
       AND (? = '' OR lower(name) LIKE ? OR tin LIKE ?)
       AND (? = '' OR group_name = ?)
     ORDER BY name COLLATE NOCASE`,
    status,
    status,
    search,
    `%${search}%`,
    `%${search}%`,
    group,
    group,
  );

  const groups = all<{ group_name: string }>(
    "SELECT DISTINCT group_name FROM farms WHERE group_name IS NOT NULL AND group_name <> '' ORDER BY group_name",
  ).map((row) => row.group_name);

  res.json({ farms: rows.map((row) => farmView(row)), groups });
});

farmsRouter.get('/:id', (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');

  const credentials = all<{
    platform: string;
    login: string | null;
    secret_enc: string | null;
    eri_password_enc: string | null;
    updated_at: string;
  }>('SELECT platform, login, secret_enc, eri_password_enc, updated_at FROM credentials WHERE farm_id = ?', row.id).map(
    (credential) => ({
      platform: credential.platform,
      login: credential.login,
      hasPassword: Boolean(credential.secret_enc),
      hasEriPassword: Boolean(credential.eri_password_enc),
      updatedAt: credential.updated_at,
    }),
  );

  res.json({ farm: farmView(row, credentials) });
});

farmsRouter.post('/', (req, res) => {
  const body = parse(farmSchema, req.body);
  if (get('SELECT id FROM farms WHERE tin = ?', body.tin)) {
    throw new HttpError(409, 'TIN_EXISTS', 'Bu STIR bilan ferma allaqachon mavjud.');
  }
  const id = crypto.randomUUID();
  const ts = now();
  run(
    `INSERT INTO farms (id, name, tin, group_name, note, one_c_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.name,
    body.tin,
    body.groupName ?? null,
    body.note ?? null,
    body.oneCUrl || null,
    ts,
    ts,
  );
  audit('buxgalter', 'farm.created', 'farm', id, { name: body.name, tin: body.tin });
  res.status(201).json({ farm: farmView(get<FarmRow>('SELECT * FROM farms WHERE id = ?', id)!) });
});

farmsRouter.patch('/:id', (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  const body = parse(farmSchema.partial(), req.body);
  if (body.tin && body.tin !== row.tin) {
    const other = get<{ id: string }>('SELECT id FROM farms WHERE tin = ? AND id <> ?', body.tin, row.id);
    if (other) throw new HttpError(409, 'TIN_EXISTS', 'Bu STIR boshqa fermada band.');
  }
  run(
    `UPDATE farms SET name = ?, tin = ?, group_name = ?, note = ?, one_c_url = ?, updated_at = ? WHERE id = ?`,
    body.name ?? row.name,
    body.tin ?? row.tin,
    body.groupName === undefined ? row.group_name : body.groupName || null,
    body.note === undefined ? row.note : body.note || null,
    body.oneCUrl === undefined ? row.one_c_url : body.oneCUrl || null,
    now(),
    row.id,
  );
  audit('buxgalter', 'farm.updated', 'farm', row.id, body);
  res.json({ farm: farmView(get<FarmRow>('SELECT * FROM farms WHERE id = ?', row.id)!) });
});

farmsRouter.post('/:id/archive', (req, res) => {
  setStatus(req.params.id, 'archived', 'farm.archived');
  res.json({ ok: true });
});

farmsRouter.post('/:id/restore', (req, res) => {
  setStatus(req.params.id, 'active', 'farm.restored');
  res.json({ ok: true });
});

function setStatus(id: string, status: string, action: string): void {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  run('UPDATE farms SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
  audit('buxgalter', action, 'farm', id);
}

farmsRouter.post('/:id/consent', (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  run('UPDATE farms SET consent_at = ?, updated_at = ? WHERE id = ?', now(), now(), row.id);
  audit('buxgalter', 'farm.consent_recorded', 'farm', row.id);
  res.json({ ok: true });
});

farmsRouter.post('/:id/key', upload.single('file'), (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', String(req.params.id));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Kalit fayli tanlanmagan.');
  const password = String((req.body as { password?: string }).password ?? '');
  if (!password) throw new HttpError(400, 'NO_PASSWORD', 'Kalit paroli kiritilmagan.');

  let info;
  try {
    info = parsePfx(req.file.buffer, password);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'KEY_UNREADABLE';
    throw new HttpError(400, code === 'KEY_UNREADABLE' ? 'KEY_PASSWORD' : code, code === 'KEY_UNREADABLE' ? 'Kalit paroli noto‘g‘ri yoki fayl buzuq.' : 'Kalitda sertifikat topilmadi.');
  }

  const session = (req as unknown as AuthedRequest).session;
  run(
    `UPDATE farms SET key_subject = ?, key_tin = ?, key_valid_to = ?, key_attached_at = ?, key_file_enc = ?, updated_at = ?
     WHERE id = ?`,
    info.subject,
    info.tin,
    info.notAfter,
    now(),
    encrypt(session.vaultKey, req.file.buffer.toString('base64')),
    now(),
    row.id,
  );
  audit('buxgalter', 'farm.key_attached', 'farm', row.id, { subject: info.subject, tin: info.tin, validTo: info.notAfter });

  res.json({
    key: {
      subject: info.subject,
      holder: info.holder,
      tin: info.tin,
      notBefore: info.notBefore,
      notAfter: info.notAfter,
      tinMismatch: Boolean(info.tin && info.tin !== row.tin),
    },
  });
});

farmsRouter.delete('/:id/key', (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  run(
    `UPDATE farms SET key_subject = NULL, key_tin = NULL, key_valid_to = NULL, key_attached_at = NULL, key_file_enc = NULL,
     updated_at = ? WHERE id = ?`,
    now(),
    row.id,
  );
  audit('buxgalter', 'farm.key_removed', 'farm', row.id);
  res.json({ ok: true });
});

const credentialsSchema = z.object({
  platform: z.enum(['didox', '1c', 'my3', 'eijara']),
  login: z.string().max(120).optional(),
  password: z.string().max(200).optional(),
  eriPassword: z.string().max(200).optional(),
  oneCUrl: z.string().optional(),
});

farmsRouter.put('/:id/credentials', (req, res) => {
  const row = get<FarmRow>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  const body = parse(credentialsSchema, req.body);
  const session = (req as unknown as AuthedRequest).session;
  const existing = get<{ login: string | null; secret_enc: string | null; eri_password_enc: string | null; extra_enc: string | null }>(
    'SELECT login, secret_enc, eri_password_enc, extra_enc FROM credentials WHERE farm_id = ? AND platform = ?',
    row.id,
    body.platform,
  );

  const login = body.login === undefined ? (existing?.login ?? null) : body.login || null;
  const secret = body.password === undefined
    ? (existing?.secret_enc ?? null)
    : body.password
      ? encrypt(session.vaultKey, body.password)
      : null;
  const eri = body.eriPassword === undefined
    ? (existing?.eri_password_enc ?? null)
    : body.eriPassword
      ? encrypt(session.vaultKey, body.eriPassword)
      : null;
  const extra = body.oneCUrl === undefined
    ? (existing?.extra_enc ?? null)
    : body.oneCUrl
      ? encrypt(session.vaultKey, body.oneCUrl)
      : null;

  run(
    `INSERT INTO credentials (farm_id, platform, login, secret_enc, eri_password_enc, extra_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(farm_id, platform) DO UPDATE SET
       login = excluded.login, secret_enc = excluded.secret_enc,
       eri_password_enc = excluded.eri_password_enc, extra_enc = excluded.extra_enc,
       updated_at = excluded.updated_at`,
    row.id,
    body.platform,
    login,
    secret,
    eri,
    extra,
    now(),
  );
  if (body.oneCUrl !== undefined) {
    run('UPDATE farms SET one_c_url = ?, updated_at = ? WHERE id = ?', body.oneCUrl || null, now(), row.id);
  }
  audit('buxgalter', 'farm.credentials_saved', 'farm', row.id, { platform: body.platform });
  res.json({ ok: true });
});

farmsRouter.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'NO_FILE', 'Fayl tanlanmagan.');
  const table = await readTable(req.file.buffer).catch(() => {
    throw new HttpError(400, 'BAD_FILE', 'Faylni o‘qib bo‘lmadi. Excel (.xlsx) yoki CSV yuklang.');
  });

  const nameCol = detectKey(table.headers, [/nomi/i, /наимен/i, /назван/i, /^name/i, /фирма/i]);
  const tinCol = detectKey(table.headers, [/stir/i, /стир/i, /^инн/i, /^inn/i, /^tin/i]);
  if (!nameCol || !tinCol) {
    throw new HttpError(400, 'NO_COLUMNS', 'Faylda "Nomi" va "STIR" ustunlari topilmadi.');
  }
  const groupCol = detectKey(table.headers, [/guruh/i, /гуруҳ/i, /групп/i, /group/i]);
  const noteCol = detectKey(table.headers, [/izoh/i, /изоҳ/i, /примеч/i, /^note/i]);
  const oneCCol = detectKey(table.headers, [/1c/i, /1с/i, /baza/i, /база/i, /url/i]);

  let created = 0;
  let updated = 0;
  const errors: Array<{ row: number; message: string }> = [];

  table.rows.forEach((row, index) => {
    const name = row[nameCol]?.trim() ?? '';
    const tin = normalizeTin(row[tinCol] ?? '');
    if (name.length < 2 || tin.length !== 9) {
      errors.push({ row: index + 2, message: 'Nom yoki STIR noto‘g‘ri' });
      return;
    }
    const existing = get<{ id: string }>('SELECT id FROM farms WHERE tin = ?', tin);
    const ts = now();
    if (existing) {
      run(
        `UPDATE farms SET name = ?, group_name = COALESCE(?, group_name), note = COALESCE(?, note),
         one_c_url = COALESCE(?, one_c_url), updated_at = ? WHERE id = ?`,
        name,
        groupCol ? row[groupCol] || null : null,
        noteCol ? row[noteCol] || null : null,
        oneCCol ? row[oneCCol] || null : null,
        ts,
        existing.id,
      );
      updated += 1;
      return;
    }
    run(
      `INSERT INTO farms (id, name, tin, group_name, note, one_c_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      name,
      tin,
      groupCol ? row[groupCol] || null : null,
      noteCol ? row[noteCol] || null : null,
      oneCCol ? row[oneCCol] || null : null,
      ts,
      ts,
    );
    created += 1;
  });

  audit('buxgalter', 'farms.imported', 'farm', undefined, { created, updated, errors: errors.length });
  res.json({ created, updated, errors, headers: table.headers });
});

farmsRouter.get('/:id/key-file', (req, res) => {
  const row = get<FarmRow & { key_file_enc: string | null }>('SELECT * FROM farms WHERE id = ?', req.params.id);
  if (!row?.key_file_enc) throw new HttpError(404, 'NO_KEY', 'Kalit biriktirilmagan.');
  const session = (req as unknown as AuthedRequest).session;
  const bytes = Buffer.from(decrypt(session.vaultKey, row.key_file_enc), 'base64');
  res.setHeader('Content-Type', 'application/x-pkcs12');
  res.setHeader('Content-Disposition', `attachment; filename="key-${row.tin}.pfx"`);
  res.send(bytes);
});
