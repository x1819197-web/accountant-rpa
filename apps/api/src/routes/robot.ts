import { Router } from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { all, get, getSetting, now, run } from '../db.js';
import { env } from '../env.js';
import { audit, HttpError, parse } from '../lib/http.js';
import { activeVaultKey, decrypt, verifyRobotToken } from '../lib/security.js';
import { resolveVariables } from '../lib/vars.js';
import { countSteps, hasIrreversible, stepSchema, variableSchema } from '../lib/scenario.js';
import type { Step, Variable } from '../lib/scenario.js';
import { emit } from '../services/events.js';
import { completeFarm } from '../services/runs.js';

export const robotRouter = Router();

robotRouter.use((req, res, next) => {
  if (!verifyRobotToken(req.header('x-robot-token'))) {
    res.status(401).json({ code: 'ROBOT_UNAUTHORIZED', message: 'Robot token yaroqsiz.' });
    return;
  }
  next();
});

interface DesktopFarm {
  id: string;
  run_id: string;
  farm_id: string;
  status: string;
  attempt: number;
}

robotRouter.get('/jobs/next', (_req, res) => {
  const vaultKey = activeVaultKey();
  if (!vaultKey) {
    res.status(423).json({ code: 'LOCKED', message: 'Master parol bilan kirish kerak — ombor qulflangan.' });
    return;
  }

  const busy = get<{ id: string }>(
    `SELECT rf.id FROM run_farms rf JOIN runs r ON r.id = rf.run_id
     WHERE r.runner = 'desktop' AND r.status = 'running' AND rf.status = 'running' LIMIT 1`,
  );
  if (busy) {
    res.json({ job: null, state: 'busy' });
    return;
  }

  const next = get<DesktopFarm>(
    `SELECT rf.id, rf.run_id, rf.farm_id, rf.status, rf.attempt FROM run_farms rf JOIN runs r ON r.id = rf.run_id
     WHERE r.runner = 'desktop' AND r.status = 'running' AND rf.status = 'queued'
     ORDER BY r.created_at, rf.rowid LIMIT 1`,
  );
  if (!next) {
    res.json({ job: null, state: 'idle' });
    return;
  }

  const waitSeconds = Number(getSetting('farm_wait_seconds') ?? 3);
  if (waitSeconds > 0) {
    const last = get<{ finished_at: string | null }>(
      `SELECT MAX(finished_at) AS finished_at FROM run_farms
       WHERE run_id = ? AND status IN ('done','error','skipped')`,
      next.run_id,
    );
    if (last?.finished_at) {
      const remaining = waitSeconds * 1000 - (Date.now() - new Date(last.finished_at).getTime());
      if (remaining > 0) {
        res.json({ job: null, state: 'waiting', retryInMs: remaining });
        return;
      }
    }
  }

  const ts = now();
  run(
    "UPDATE run_farms SET status = 'running', started_at = ?, attempt = attempt + 1, updated_at = ? WHERE id = ? AND status = 'queued'",
    ts,
    ts,
    next.id,
  );

  const runRow = get<{
    id: string;
    scenario_id: string;
    scenario_version: number;
    dataset_id: string | null;
    mode: 'dry' | 'live';
    status: string;
  }>('SELECT id, scenario_id, scenario_version, dataset_id, mode, status FROM runs WHERE id = ?', next.run_id);
  if (!runRow) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run topilmadi.');

  const scenario = get<{ id: string; name: string; platform: string }>(
    'SELECT id, name, platform FROM scenarios WHERE id = ?',
    runRow.scenario_id,
  );
  const version = get<{ steps_json: string; variables_json: string }>(
    'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
    runRow.scenario_id,
    runRow.scenario_version,
  );
  const farm = get<{
    id: string;
    name: string;
    tin: string;
    one_c_url: string | null;
    key_subject: string | null;
    key_valid_to: string | null;
  }>('SELECT id, name, tin, one_c_url, key_subject, key_valid_to FROM farms WHERE id = ?', next.farm_id);
  if (!scenario || !version || !farm) throw new HttpError(409, 'JOB_BROKEN', 'Job ma’lumoti to‘liq emas.');

  const steps = JSON.parse(version.steps_json) as Step[];
  const variables = JSON.parse(version.variables_json) as Variable[];
  const values = resolveVariables(variables, farm, runRow.dataset_id).values;

  const credential =
    get<{ login: string | null; secret_enc: string | null; eri_password_enc: string | null; extra_enc: string | null }>(
      'SELECT login, secret_enc, eri_password_enc, extra_enc FROM credentials WHERE farm_id = ? AND platform = ?',
      farm.id,
      scenario.platform,
    ) ??
    get<{ login: string | null; secret_enc: string | null; eri_password_enc: string | null; extra_enc: string | null }>(
      'SELECT login, secret_enc, eri_password_enc, extra_enc FROM credentials WHERE farm_id = ? AND eri_password_enc IS NOT NULL LIMIT 1',
      farm.id,
    );

  emit(runRow.id, 'farm_started', `${farm.name} boshlandi.`, { farm: farm.name, runner: 'desktop' }, next.id);

  res.json({
    state: 'job',
    job: {
      id: next.id,
      runId: runRow.id,
      mode: runRow.mode,
      scenario: { id: scenario.id, name: scenario.name, platform: scenario.platform, steps, variables },
      farm: {
        id: farm.id,
        name: farm.name,
        tin: farm.tin,
        oneCUrl: farm.one_c_url,
        keySubject: farm.key_subject,
        keyValidTo: farm.key_valid_to,
      },
      values,
      secrets: {
        login: credential?.login ?? null,
        password: credential?.secret_enc ? decrypt(vaultKey, credential.secret_enc) : null,
        eriPassword: credential?.eri_password_enc ? decrypt(vaultKey, credential.eri_password_enc) : null,
        oneCUrl: credential?.extra_enc ? decrypt(vaultKey, credential.extra_enc) : farm.one_c_url,
      },
      serverTime: ts,
    },
  });
});

robotRouter.get('/runs/:id/state', (req, res) => {
  const run = get<{ status: string; mode: string }>('SELECT status, mode FROM runs WHERE id = ?', req.params.id);
  if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');
  res.json({ status: run.status, mode: run.mode });
});

robotRouter.post('/jobs/:id/event', (req, res) => {
  const body = parse(
    z.object({
      type: z.enum(['step', 'step_skipped', 'manual_required', 'log', 'screenshot']),
      message: z.string().max(500).optional(),
      data: z.unknown().optional(),
    }),
    req.body,
  );
  const farm = get<{ run_id: string; farm_id: string }>(
    'SELECT run_id, farm_id FROM run_farms WHERE id = ?',
    req.params.id,
  );
  if (!farm) throw new HttpError(404, 'NOT_FOUND', 'Job topilmadi.');

  const data = body.data as { step?: string; type?: string; irreversible?: boolean } | null;
  if (body.type === 'step' && data && (data.type === 'sign' || (data.type === 'click' && data.irreversible))) {
    const runRow = get<{ scenario_id: string; scenario_version: number }>(
      'SELECT scenario_id, scenario_version FROM runs WHERE id = ?',
      farm.run_id,
    );
    audit('robot', 'run.irreversible_step', 'run', farm.run_id, {
      farmId: farm.farm_id,
      step: data.step ?? null,
      type: data.type,
      scenarioId: runRow?.scenario_id ?? null,
      scenarioVersion: runRow?.scenario_version ?? null,
    });
  }

  emit(farm.run_id, body.type, body.message ?? null, body.data ?? null, req.params.id);
  res.json({ ok: true });
});

robotRouter.post('/jobs/:id/complete', (req, res) => {
  const body = parse(
    z.object({
      ok: z.boolean(),
      errorCode: z.string().max(80).optional(),
      errorMessage: z.string().max(600).optional(),
      screenshotBase64: z.string().optional(),
    }),
    req.body,
  );
  const farm = get<{ run_id: string }>('SELECT run_id FROM run_farms WHERE id = ?', req.params.id);
  if (!farm) throw new HttpError(404, 'NOT_FOUND', 'Job topilmadi.');

  let screenshot: string | null = null;
  if (body.screenshotBase64) {
    const base64 = body.screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 8 * 1024 * 1024) throw new HttpError(413, 'SCREENSHOT_TOO_BIG', 'Screenshot 8 MB dan katta.');
    const fileName = `${req.params.id}.png`;
    fs.writeFileSync(path.join(env.dataDir, 'screenshots', fileName), bytes);
    screenshot = `screenshots/${fileName}`;
  }

  completeFarm(req.params.id, {
    ok: body.ok,
    errorCode: body.errorCode,
    errorMessage: body.errorMessage,
    screenshot,
  });
  res.json({ ok: true });
});

robotRouter.get('/farms/:id/secrets', (req, res) => {
  const vaultKey = activeVaultKey();
  if (!vaultKey) {
    res.status(423).json({ code: 'LOCKED', message: 'Ombor qulflangan.' });
    return;
  }
  const rows = all<{ platform: string; login: string | null; secret_enc: string | null; eri_password_enc: string | null; extra_enc: string | null }>(
    'SELECT platform, login, secret_enc, eri_password_enc, extra_enc FROM credentials WHERE farm_id = ?',
    req.params.id,
  );
  res.json({
    credentials: rows.map((row) => ({
      platform: row.platform,
      login: row.login,
      password: row.secret_enc ? decrypt(vaultKey, row.secret_enc) : null,
      eriPassword: row.eri_password_enc ? decrypt(vaultKey, row.eri_password_enc) : null,
      extra: row.extra_enc ? decrypt(vaultKey, row.extra_enc) : null,
    })),
  });
});

const robotScenarioSchema = z.object({
  name: z.string().min(2),
  platform: z.enum(['didox', '1c', 'my3', 'eijara', 'other']),
  folder: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  steps: z.array(stepSchema),
  variables: z.array(variableSchema).default([]),
  note: z.string().max(300).optional(),
});

function saveRobotVersion(scenarioId: string, version: number, steps: Step[], variables: Variable[], note: string): void {
  run(
    `INSERT INTO scenario_versions (id, scenario_id, version, steps_json, variables_json, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    scenarioId,
    version,
    JSON.stringify(steps),
    JSON.stringify(variables),
    note,
    now(),
  );
}

robotRouter.get('/scenarios', (_req, res) => {
  const rows = all<{
    id: string;
    name: string;
    platform: string;
    folder: string | null;
    current_version: number;
    updated_at: string;
    steps_json: string | null;
  }>(
    `SELECT s.id, s.name, s.platform, s.folder, s.current_version, s.updated_at, v.steps_json
     FROM scenarios s LEFT JOIN scenario_versions v ON v.scenario_id = s.id AND v.version = s.current_version
     WHERE s.status = 'active' ORDER BY s.updated_at DESC`,
  );
  res.json({
    scenarios: rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      folder: row.folder,
      version: row.current_version,
      stepsCount: row.steps_json ? countSteps(JSON.parse(row.steps_json) as Step[]) : 0,
      hasIrreversible: row.steps_json ? hasIrreversible(JSON.parse(row.steps_json) as Step[]) : false,
      updatedAt: row.updated_at,
    })),
  });
});

robotRouter.get('/scenarios/:id', (req, res) => {
  const row = get<{ id: string; name: string; platform: string; folder: string | null; current_version: number }>(
    'SELECT id, name, platform, folder, current_version FROM scenarios WHERE id = ?',
    req.params.id,
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Scenario topilmadi.');
  const version = get<{ steps_json: string; variables_json: string }>(
    'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
    row.id,
    row.current_version,
  );
  res.json({
    scenario: { id: row.id, name: row.name, platform: row.platform, folder: row.folder, version: row.current_version },
    steps: version ? JSON.parse(version.steps_json) : [],
    variables: version ? JSON.parse(version.variables_json) : [],
  });
});

robotRouter.post('/scenarios', (req, res) => {
  const body = parse(robotScenarioSchema, req.body);
  const id = crypto.randomUUID();
  const ts = now();
  run(
    `INSERT INTO scenarios (id, name, platform, folder, description, current_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    body.name,
    body.platform,
    body.folder || null,
    body.description || null,
    ts,
    ts,
  );
  saveRobotVersion(id, 1, body.steps, body.variables, body.note ?? 'Desktop yozuvidan');
  audit('robot', 'scenario.recorded', 'scenario', id, { name: body.name, steps: countSteps(body.steps) });
  res.status(201).json({ scenario: { id, name: body.name, platform: body.platform, version: 1 } });
});

robotRouter.put('/scenarios/:id', (req, res) => {
  const row = get<{ id: string; name: string; current_version: number }>(
    'SELECT id, name, current_version FROM scenarios WHERE id = ?',
    req.params.id,
  );
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Scenario topilmadi.');
  const body = parse(robotScenarioSchema.pick({ steps: true, variables: true, note: true }), req.body);
  const nextVersion = row.current_version + 1;
  saveRobotVersion(row.id, nextVersion, body.steps, body.variables, body.note ?? `Desktop yozuvi v${nextVersion}`);
  run('UPDATE scenarios SET current_version = ?, updated_at = ? WHERE id = ?', nextVersion, now(), row.id);
  audit('robot', 'scenario.recorded', 'scenario', row.id, { version: nextVersion, steps: countSteps(body.steps) });
  res.json({ scenario: { id: row.id, name: row.name, version: nextVersion } });
});
