import { Router } from 'express';
import { z } from 'zod';
import { all, get, now, run } from '../db.js';
import { HttpError, audit, parse } from '../lib/http.js';
import { countSteps, hasIrreversible, scenarioInputSchema, stepSchema, variableSchema, type Step, type Variable } from '../lib/scenario.js';

export const scenariosRouter = Router();

interface ScenarioRow {
  id: string;
  name: string;
  platform: string;
  folder: string | null;
  description: string | null;
  status: 'active' | 'archived';
  current_version: number;
  created_at: string;
  updated_at: string;
  steps_json?: string | null;
  variables_json?: string | null;
}

const saveSchema = z.object({
  steps: z.array(stepSchema),
  variables: z.array(variableSchema).default([]),
  note: z.string().max(300).optional(),
});

function scenarioView(row: ScenarioRow) {
  const steps = row.steps_json ? (JSON.parse(row.steps_json) as Step[]) : [];
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    folder: row.folder,
    description: row.description,
    status: row.status,
    version: row.current_version,
    stepsCount: countSteps(steps),
    hasIrreversible: hasIrreversible(steps),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

scenariosRouter.get('/', (req, res) => {
  const platform = String(req.query.platform ?? '');
  const search = String(req.query.search ?? '').trim();
  const rows = all<ScenarioRow>(
    `SELECT s.*, v.steps_json FROM scenarios s
     LEFT JOIN scenario_versions v ON v.scenario_id = s.id AND v.version = s.current_version
     WHERE (? = '' OR s.platform = ?) AND (? = '' OR s.name LIKE ?)
     ORDER BY s.updated_at DESC`,
    platform,
    platform,
    search,
    `%${search}%`,
  );
  res.json({ scenarios: rows.map(scenarioView) });
});

scenariosRouter.get('/:id', (req, res) => {
  const row = getScenario(req.params.id);
  const version = row.current_version
    ? get<{ steps_json: string; variables_json: string; note: string | null; created_at: string }>(
        'SELECT steps_json, variables_json, note, created_at FROM scenario_versions WHERE scenario_id = ? AND version = ?',
        row.id,
        row.current_version,
      )
    : undefined;
  const versions = all<{ version: number; note: string | null; created_at: string }>(
    'SELECT version, note, created_at FROM scenario_versions WHERE scenario_id = ? ORDER BY version DESC',
    row.id,
  );
  res.json({
    scenario: scenarioView(row),
    steps: version ? JSON.parse(version.steps_json) : [],
    variables: version ? JSON.parse(version.variables_json) : [],
    versions,
  });
});

scenariosRouter.post('/', (req, res) => {
  const body = parse(scenarioInputSchema, req.body);
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
  saveVersion(id, 1, body.steps, body.variables, body.note ?? 'Birinchi versiya');
  audit('buxgalter', 'scenario.created', 'scenario', id, { name: body.name, platform: body.platform });
  res.status(201).json({ scenario: scenarioView(getScenario(id)) });
});

scenariosRouter.patch('/:id', (req, res) => {
  const row = getScenario(req.params.id);
  const body = parse(
    z.object({
      name: z.string().min(2).max(120).optional(),
      folder: z.string().max(80).optional(),
      description: z.string().max(500).optional(),
    }),
    req.body,
  );
  const name = body.name ?? row.name;
  const folder = body.folder === undefined ? row.folder : body.folder || null;
  const description = body.description === undefined ? row.description : body.description || null;
  run('UPDATE scenarios SET name = ?, folder = ?, description = ?, updated_at = ? WHERE id = ?', name, folder, description, now(), row.id);
  audit('buxgalter', 'scenario.updated', 'scenario', row.id, { name, folder });
  const fresh = get<ScenarioRow>(
    `SELECT s.*, v.steps_json FROM scenarios s
     LEFT JOIN scenario_versions v ON v.scenario_id = s.id AND v.version = s.current_version
     WHERE s.id = ?`,
    row.id,
  );
  res.json({ scenario: scenarioView(fresh ?? row) });
});

scenariosRouter.put('/:id', (req, res) => {
  const row = getScenario(req.params.id);
  const body = parse(saveSchema, req.body);
  const nextVersion = row.current_version + 1;
  saveVersion(row.id, nextVersion, body.steps, body.variables, body.note ?? `Versiya ${nextVersion}`);
  run('UPDATE scenarios SET current_version = ?, updated_at = ? WHERE id = ?', nextVersion, now(), row.id);
  audit('buxgalter', 'scenario.version_saved', 'scenario', row.id, { version: nextVersion });
  res.json({ scenario: scenarioView(getScenario(row.id)) });
});

scenariosRouter.post('/:id/rollback', (req, res) => {
  const row = getScenario(req.params.id);
  const body = parse(z.object({ version: z.number().int().positive() }), req.body);
  const source = get<{ steps_json: string; variables_json: string }>(
    'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
    row.id,
    body.version,
  );
  if (!source) throw new HttpError(404, 'VERSION_NOT_FOUND', 'Bunday versiya topilmadi.');
  const nextVersion = row.current_version + 1;
  saveVersion(row.id, nextVersion, JSON.parse(source.steps_json), JSON.parse(source.variables_json), `Versiya ${body.version} dan qaytarildi`);
  run('UPDATE scenarios SET current_version = ?, updated_at = ? WHERE id = ?', nextVersion, now(), row.id);
  audit('buxgalter', 'scenario.rolled_back', 'scenario', row.id, { from: body.version, to: nextVersion });
  res.json({ scenario: scenarioView(getScenario(row.id)) });
});

scenariosRouter.post('/:id/copy', (req, res) => {
  const row = getScenario(req.params.id);
  const id = crypto.randomUUID();
  const ts = now();
  const source = row.current_version
    ? get<{ steps_json: string; variables_json: string }>(
        'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
        row.id,
        row.current_version,
      )
    : undefined;
  run(
    `INSERT INTO scenarios (id, name, platform, folder, description, current_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    `${row.name} (nusxa)`,
    row.platform,
    row.folder,
    row.description,
    source ? 1 : 0,
    ts,
    ts,
  );
  if (source) saveVersion(id, 1, JSON.parse(source.steps_json), JSON.parse(source.variables_json), 'Nusxa');
  audit('buxgalter', 'scenario.copied', 'scenario', id, { from: row.id });
  res.status(201).json({ scenario: scenarioView(getScenario(id)) });
});

scenariosRouter.delete('/:id', (req, res) => {
  const row = getScenario(req.params.id);
  const used = get<{ count: number }>('SELECT COUNT(*) AS count FROM runs WHERE scenario_id = ?', row.id);
  if ((used?.count ?? 0) > 0) {
    throw new HttpError(409, 'SCENARIO_IN_USE', 'Bu scenarioda run tarixi bor — uni arxivlang (tarix saqlanadi).');
  }
  run('DELETE FROM scenarios WHERE id = ?', row.id);
  audit('buxgalter', 'scenario.deleted', 'scenario', row.id, { name: row.name });
  res.json({ ok: true });
});

scenariosRouter.post('/:id/archive', (req, res) => {
  setScenarioStatus(req.params.id, 'archived', 'scenario.archived');
  res.json({ ok: true });
});

scenariosRouter.post('/:id/restore', (req, res) => {
  setScenarioStatus(req.params.id, 'active', 'scenario.restored');
  res.json({ ok: true });
});

function setScenarioStatus(id: string, status: string, action: string): void {
  const row = getScenario(id);
  run('UPDATE scenarios SET status = ?, updated_at = ? WHERE id = ?', status, now(), row.id);
  audit('buxgalter', action, 'scenario', row.id);
}

function getScenario(id: string): ScenarioRow {
  const row = get<ScenarioRow>('SELECT * FROM scenarios WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Scenario topilmadi.');
  return row;
}

function saveVersion(id: string, version: number, steps: Step[], variables: Variable[], note: string): void {
  run(
    `INSERT INTO scenario_versions (id, scenario_id, version, steps_json, variables_json, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(),
    id,
    version,
    JSON.stringify(steps),
    JSON.stringify(variables),
    note,
    now(),
  );
}
