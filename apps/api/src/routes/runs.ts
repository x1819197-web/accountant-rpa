import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { all, get } from '../db.js';
import { env } from '../env.js';
import { HttpError, parse } from '../lib/http.js';
import { listEvents, subscribe, runExists } from '../services/events.js';
import { approveRun, cancelRun, createRun, pauseRun, resumeRun, retryFailed, runView } from '../services/runs.js';
import { requireAuth } from '../lib/security.js';

export const runsRouter = Router();
runsRouter.use(requireAuth);

const createSchema = z.object({
  scenarioId: z.string().min(1),
  farmIds: z.array(z.string().min(1)).min(1),
  mode: z.enum(['dry', 'live']),
  datasetId: z.string().nullable().optional(),
});

runsRouter.get('/', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  const rows = all<{
    id: string;
    scenario_name: string;
    scenario_id: string;
    scenario_version: number;
    mode: string;
    runner: string;
    status: string;
    total_farms: number;
    done_count: number;
    error_count: number;
    skipped_count: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
  }>(
    `SELECT r.*, s.name AS scenario_name FROM runs r JOIN scenarios s ON s.id = r.scenario_id
     ORDER BY r.created_at DESC LIMIT ?`,
    limit,
  );
  res.json({
    runs: rows.map((row) => ({
      id: row.id,
      scenarioId: row.scenario_id,
      scenarioName: row.scenario_name,
      scenarioVersion: row.scenario_version,
      mode: row.mode,
      runner: row.runner,
      status: row.status,
      totalFarms: row.total_farms,
      doneCount: row.done_count,
      errorCount: row.error_count,
      skippedCount: row.skipped_count,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    })),
  });
});

runsRouter.post('/', (req, res) => {
  const body = parse(createSchema, req.body);
  const row = createRun(body);
  res.status(201).json(runView(row.id));
});

runsRouter.get('/:id', (req, res) => {
  if (!runExists(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');
  res.json(runView(req.params.id));
});

runsRouter.get('/:id/events', (req, res) => {
  if (!runExists(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');
  const after = Number(req.query.after ?? 0);
  res.json({ events: listEvents(req.params.id, Number.isFinite(after) ? after : 0) });
});

runsRouter.get('/:id/stream', (req, res) => {
  if (!runExists(req.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');
  subscribe(req.params.id, res);
});

runsRouter.post('/:id/approve', (req, res) => {
  res.json(runView(approveRun(req.params.id).id));
});

runsRouter.post('/:id/pause', (req, res) => {
  res.json(runView(pauseRun(req.params.id).id));
});

runsRouter.post('/:id/resume', (req, res) => {
  res.json(runView(resumeRun(req.params.id).id));
});

runsRouter.post('/:id/cancel', (req, res) => {
  res.json(runView(cancelRun(req.params.id).id));
});

runsRouter.post('/:id/retry-failed', (req, res) => {
  res.json(runView(retryFailed(req.params.id).id));
});

runsRouter.get('/:id/farms/:runFarmId/screenshot', (req, res) => {
  const farm = get<{ screenshot: string | null }>(
    'SELECT screenshot FROM run_farms WHERE id = ? AND run_id = ?',
    req.params.runFarmId,
    req.params.id,
  );
  if (!farm?.screenshot) throw new HttpError(404, 'NO_SCREENSHOT', 'Screenshot yo‘q.');
  const file = path.join(env.dataDir, farm.screenshot);
  if (!file.startsWith(env.dataDir) || !fs.existsSync(file)) throw new HttpError(404, 'NO_SCREENSHOT', 'Screenshot topilmadi.');
  res.sendFile(file);
});
