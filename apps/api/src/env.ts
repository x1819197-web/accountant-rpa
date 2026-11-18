import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '../../..');

export const env = {
  port: Number(process.env.PORT ?? 3100),
  dataDir: path.resolve(process.env.RPA_DATA_DIR ?? path.join(root, 'data')),
  webDist: path.resolve(process.env.RPA_WEB_DIST ?? path.join(root, 'apps/web/dist')),
  publicDir: path.join(root, 'apps/api/public'),
  isProduction: process.env.NODE_ENV === 'production',
  sessionHours: Number(process.env.RPA_SESSION_HOURS ?? 12),
  idleLockMinutes: Number(process.env.RPA_IDLE_LOCK_MINUTES ?? 30),
  simulatorDelayMs: Number(process.env.RPA_SIM_DELAY_MS ?? 900),
};

for (const dir of [env.dataDir, path.join(env.dataDir, 'screenshots'), path.join(env.dataDir, 'exports'), path.join(env.dataDir, 'keys')]) {
  fs.mkdirSync(dir, { recursive: true });
}
