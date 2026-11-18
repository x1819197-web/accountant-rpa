import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.js';
import { getSetting, setSetting } from '../db.js';

const SECRET_FILE = path.join(env.dataDir, '.session-secret');
const secret: Buffer = (() => {
  if (fs.existsSync(SECRET_FILE)) return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'hex');
  const created = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, created.toString('hex'), { mode: 0o600 });
  return created;
})();

export interface Session {
  sid: string;
  vaultKey: Buffer;
  createdAt: number;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

function scrypt(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: scrypt(password, salt).toString('hex') };
}

export function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  const actual = scrypt(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function deriveVaultKey(password: string): Buffer {
  let saltHex = getSetting('vault_salt');
  if (!saltHex) {
    saltHex = crypto.randomBytes(16).toString('hex');
    setSetting('vault_salt', saltHex);
  }
  return scrypt(password, Buffer.from(saltHex, 'hex'));
}

export function encrypt(key: Buffer, plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(key: Buffer, payload: string): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueSession(vaultKey: Buffer): Session {
  const sid = crypto.randomBytes(24).toString('base64url');
  const session: Session = { sid, vaultKey, createdAt: Date.now(), lastSeen: Date.now() };
  sessions.set(sid, session);
  return session;
}

export function cookieValue(session: Session): string {
  return `${session.sid}.${sign(session.sid)}`;
}

export function readSession(req: Request): Session | undefined {
  const raw = (req.cookies as Record<string, string> | undefined)?.rpa_session;
  if (!raw) return undefined;
  const [sid, mac] = raw.split('.');
  if (!sid || !mac || sign(sid) !== mac) return undefined;
  const session = sessions.get(sid);
  if (!session) return undefined;
  const idleMs = env.idleLockMinutes * 60_000;
  const ageMs = env.sessionHours * 3600_000;
  if (Date.now() - session.lastSeen > idleMs || Date.now() - session.createdAt > ageMs) {
    sessions.delete(sid);
    return undefined;
  }
  session.lastSeen = Date.now();
  return session;
}

export function destroySession(session: Session | undefined): void {
  if (session) sessions.delete(session.sid);
}

export type AuthedRequest = Request & { session: Session };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ code: 'LOCKED', message: 'Sessiya tugadi. Master parolni qayta kiriting.' });
    return;
  }
  (req as AuthedRequest).session = session;
  next();
}

export function activeVaultKey(): Buffer | undefined {
  let latest: Session | undefined;
  for (const session of sessions.values()) {
    if (!latest || session.lastSeen > latest.lastSeen) latest = session;
  }
  return latest?.vaultKey;
}

export function robotToken(): string {
  const expires = Date.now() + 180 * 24 * 3600_000;
  return `${expires}.${sign(`robot.${expires}`)}`;
}

export function verifyRobotToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac) return false;
  if (!Number(expires) || Number(expires) < Date.now()) return false;
  return sign(`robot.${expires}`) === mac;
}
