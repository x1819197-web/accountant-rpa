import { Router } from 'express';
import { z } from 'zod';
import { getSetting, setSetting } from '../db.js';
import { audit, parse } from '../lib/http.js';
import { env } from '../env.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json({
    runnerMode: getSetting('runner_mode') ?? 'simulated',
    manualMinutesPerFarm: Number(getSetting('manual_minutes_per_farm') ?? 12),
    stopOnError: getSetting('stop_on_error') === '1',
    farmWaitSeconds: Number(getSetting('farm_wait_seconds') ?? 3),
    accountabilityAcceptedAt: getSetting('accountability_accepted_at') ?? null,
    dataDir: env.dataDir,
    version: '0.1.0',
  });
});

settingsRouter.patch('/', (req, res) => {
  const body = parse(
    z.object({
      runnerMode: z.enum(['simulated', 'desktop']).optional(),
      manualMinutesPerFarm: z.number().int().min(1).max(240).optional(),
      stopOnError: z.boolean().optional(),
      farmWaitSeconds: z.number().int().min(0).max(600).optional(),
    }),
    req.body,
  );
  if (body.runnerMode) setSetting('runner_mode', body.runnerMode);
  if (body.manualMinutesPerFarm) setSetting('manual_minutes_per_farm', String(body.manualMinutesPerFarm));
  if (body.stopOnError !== undefined) setSetting('stop_on_error', body.stopOnError ? '1' : '0');
  if (body.farmWaitSeconds !== undefined) setSetting('farm_wait_seconds', String(body.farmWaitSeconds));
  audit('buxgalter', 'settings.updated', 'settings', 'app', body);
  res.json({
    ok: true,
    runnerMode: getSetting('runner_mode'),
    manualMinutesPerFarm: getSetting('manual_minutes_per_farm'),
    stopOnError: getSetting('stop_on_error') === '1',
    farmWaitSeconds: Number(getSetting('farm_wait_seconds') ?? 3),
  });
});
