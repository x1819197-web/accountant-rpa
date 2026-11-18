import { Router } from 'express';
import { z } from 'zod';
import { getSetting, now, setSetting } from '../db.js';
import { HttpError, audit, parse } from '../lib/http.js';
import {
  cookieValue,
  decrypt,
  deriveVaultKey,
  destroySession,
  encrypt,
  hashPassword,
  issueSession,
  readSession,
  requireAuth,
  robotToken,
  verifyPassword,
  type AuthedRequest,
} from '../lib/security.js';

export const authRouter = Router();

const attempts = new Map<string, { count: number; resetAt: number }>();

const credentialsSchema = z.object({
  password: z.string().min(8, 'Kamida 8 belgi'),
});

authRouter.get('/status', (req, res) => {
  const setup = Boolean(getSetting('password_hash'));
  res.json({ setup, unlocked: Boolean(readSession(req)) });
});

authRouter.post('/setup', (req, res) => {
  if (getSetting('password_hash')) throw new HttpError(409, 'ALREADY_SETUP', 'Master parol allaqachon o‘rnatilgan.');
  const body = parse(credentialsSchema.extend({ acceptTerms: z.literal(true) }), req.body);

  const { salt, hash } = hashPassword(body.password);
  setSetting('password_hash', hash);
  setSetting('password_salt', salt);
  const vaultKey = deriveVaultKey(body.password);
  setSetting('vault_check', encrypt(vaultKey, 'ok'));
  setSetting('accountability_accepted_at', now());
  setSetting('runner_mode', getSetting('runner_mode') ?? 'simulated');
  setSetting('manual_minutes_per_farm', getSetting('manual_minutes_per_farm') ?? '12');

  const session = issueSession(vaultKey);
  res.cookie('rpa_session', cookieValue(session), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 3600_000,
    path: '/',
  });
  audit('buxgalter', 'auth.setup', 'settings');
  audit('buxgalter', 'accountability.accepted', 'settings');
  res.json({ ok: true, robotToken: robotToken() });
});

authRouter.post('/login', (req, res) => {
  const ip = req.ip ?? 'local';
  const nowMs = Date.now();
  const attempt = attempts.get(ip);
  if (attempt && attempt.resetAt > nowMs && attempt.count >= 10) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Juda ko‘p urinish. 5 daqiqadan keyin qayta urinib ko‘ring.');
  }

  const body = parse(credentialsSchema, req.body);
  const hash = getSetting('password_hash');
  const salt = getSetting('password_salt');
  if (!hash || !salt) throw new HttpError(409, 'NOT_SETUP', 'Avval master parolni o‘rnating.');

  if (!verifyPassword(body.password, salt, hash)) {
    const next = attempt && attempt.resetAt > nowMs ? attempt : { count: 0, resetAt: nowMs + 5 * 60_000 };
    next.count += 1;
    attempts.set(ip, next);
    audit('buxgalter', 'auth.login_failed', 'settings');
    throw new HttpError(401, 'BAD_PASSWORD', 'Parol noto‘g‘ri.');
  }

  attempts.delete(ip);
  const vaultKey = deriveVaultKey(body.password);
  const check = getSetting('vault_check');
  try {
    if (!check || decrypt(vaultKey, check) !== 'ok') throw new Error('VAULT');
  } catch {
    throw new HttpError(409, 'VAULT_MISMATCH', 'Ombor kaliti mos kelmadi.');
  }

  const session = issueSession(vaultKey);
  res.cookie('rpa_session', cookieValue(session), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 12 * 3600_000,
    path: '/',
  });
  audit('buxgalter', 'auth.login', 'settings');
  res.json({ ok: true, robotToken: robotToken() });
});

authRouter.post('/lock', requireAuth, (req, res) => {
  destroySession((req as AuthedRequest).session);
  res.clearCookie('rpa_session', { path: '/' });
  audit('buxgalter', 'auth.lock', 'settings');
  res.json({ ok: true });
});

authRouter.get('/robot-token', requireAuth, (_req, res) => {
  res.json({ token: robotToken(), expiresInDays: 180 });
});
