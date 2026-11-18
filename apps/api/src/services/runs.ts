import { db, all, get, getSetting, now, run } from '../db.js';
import { HttpError, audit } from '../lib/http.js';
import { hasIrreversible, type Step, type Variable } from '../lib/scenario.js';
import { resolveVariables } from '../lib/vars.js';
import { emit } from './events.js';
import { env } from '../env.js';

export interface RunRow {
  id: string;
  scenario_id: string;
  scenario_version: number;
  dataset_id: string | null;
  mode: 'dry' | 'live';
  runner: 'simulated' | 'desktop';
  status: 'awaiting_approval' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed';
  total_farms: number;
  done_count: number;
  error_count: number;
  skipped_count: number;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  created_at: string;
}

export interface RunFarmRow {
  id: string;
  run_id: string;
  farm_id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped';
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  screenshot: string | null;
  attempt: number;
  updated_at: string;
}

interface FarmRow {
  id: string;
  name: string;
  tin: string;
  note: string | null;
  one_c_url: string | null;
  key_valid_to: string | null;
  key_tin: string | null;
  status: string;
}

const simulating = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRun(runId: string): RunRow {
  const row = get<RunRow>('SELECT * FROM runs WHERE id = ?', runId);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');
  return row;
}

function scenarioOf(run: RunRow): { name: string; steps: Step[]; variables: Variable[] } {
  const scenario = get<{ name: string }>('SELECT name FROM scenarios WHERE id = ?', run.scenario_id);
  const version = get<{ steps_json: string; variables_json: string }>(
    'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
    run.scenario_id,
    run.scenario_version,
  );
  return {
    name: scenario?.name ?? 'Scenario',
    steps: version ? (JSON.parse(version.steps_json) as Step[]) : [],
    variables: version ? (JSON.parse(version.variables_json) as Variable[]) : [],
  };
}

function keyExpired(farm: FarmRow): boolean {
  return Boolean(farm.key_valid_to && new Date(farm.key_valid_to).getTime() < Date.now());
}

function needsEriKey(steps: Step[]): boolean {
  let needed = false;
  const visit = (list: Step[]) => {
    for (const step of list) {
      if (step.type === 'eimzo-login') needed = true;
      if (step.type === 'loop') visit(step.steps);
      if (step.type === 'condition') {
        visit(step.then);
        visit(step.otherwise);
      }
    }
  };
  visit(steps);
  return needed;
}

export function createRun(input: {
  scenarioId: string;
  farmIds: string[];
  mode: 'dry' | 'live';
  datasetId?: string | null;
}): RunRow {
  if (!input.farmIds.length) throw new HttpError(400, 'NO_FARMS', 'Kamida bitta ferma tanlang.');
  const scenario = get<{ id: string; name: string; current_version: number; status: string }>(
    'SELECT id, name, current_version, status FROM scenarios WHERE id = ?',
    input.scenarioId,
  );
  if (!scenario) throw new HttpError(404, 'SCENARIO_NOT_FOUND', 'Scenario topilmadi.');
  if (scenario.status !== 'active') throw new HttpError(409, 'SCENARIO_ARCHIVED', 'Arxivlangan scenario bilan run boshlanmaydi.');
  if (scenario.current_version === 0) throw new HttpError(409, 'NO_VERSION', 'Scenarioda qadamlar yo‘q.');

  const version = get<{ steps_json: string; variables_json: string }>(
    'SELECT steps_json, variables_json FROM scenario_versions WHERE scenario_id = ? AND version = ?',
    scenario.id,
    scenario.current_version,
  );
  const steps = version ? (JSON.parse(version.steps_json) as Step[]) : [];
  const variables = version ? (JSON.parse(version.variables_json) as Variable[]) : [];
  if (steps.length === 0) throw new HttpError(409, 'NO_STEPS', 'Scenarioda qadamlar yo‘q.');

  const irreversible = hasIrreversible(steps);
  if (input.mode === 'live') {
    const trial = get<{ id: string }>(
      `SELECT rf.id FROM run_farms rf JOIN runs r ON r.id = rf.run_id
       WHERE r.scenario_id = ? AND r.scenario_version = ? AND rf.status = 'done' LIMIT 1`,
      scenario.id,
      scenario.current_version,
    );
    if (!trial) {
      throw new HttpError(409, 'TRIAL_REQUIRED', 'Yangi yoki tahrirlangan scenario avval bitta fermada muvaffaqiyatli sinovdan o‘tishi kerak (BR-04). Dry run qiling.');
    }
  }

  if (input.datasetId) {
    if (!get('SELECT id FROM datasets WHERE id = ?', input.datasetId)) {
      throw new HttpError(400, 'DATASET_NOT_FOUND', 'Ma’lumotlar to‘plami topilmadi.');
    }
  }

  const uniqueIds = [...new Set(input.farmIds)];
  const farms = all<FarmRow>(
    `SELECT id, name, tin, note, one_c_url, key_valid_to, key_tin, status FROM farms
     WHERE id IN (${uniqueIds.map(() => '?').join(',')})`,
    ...uniqueIds,
  );
  if (farms.length !== uniqueIds.length) throw new HttpError(400, 'FARM_NOT_FOUND', 'Ba’zi fermalar topilmadi.');

  const runnerMode = getSetting('runner_mode') === 'desktop' ? 'desktop' : 'simulated';
  const requiresApproval = input.mode === 'live' && irreversible;
  const runId = crypto.randomUUID();
  const ts = now();
  const eriNeeded = needsEriKey(steps);
  const passwordPlatforms = new Set<string>();
  const visit = (list: Step[]) => {
    for (const step of list) {
      if (step.type === 'password-login') passwordPlatforms.add(step.platform);
      if (step.type === 'loop') visit(step.steps);
      if (step.type === 'condition') {
        visit(step.then);
        visit(step.otherwise);
      }
    }
  };
  visit(steps);

  const planned: Array<{ farm: FarmRow; skip?: { code: string; message: string } }> = farms.map((farm) => {
    if (farm.status !== 'active') return { farm, skip: { code: 'FARM_ARCHIVED', message: 'Ferma arxivlangan' } };
    if (keyExpired(farm)) return { farm, skip: { code: 'KEY_EXPIRED', message: 'Kalit muddati tugagan' } };
    if (farm.key_tin && farm.key_tin !== farm.tin) {
      return { farm, skip: { code: 'KEY_TIN_MISMATCH', message: 'Kalit TIN ferma TINiga mos emas' } };
    }
    if (eriNeeded && !farm.key_valid_to) return { farm, skip: { code: 'KEY_MISSING', message: 'E-IMZO kaliti biriktirilmagan' } };
    const resolved = resolveVariables(variables, farm, input.datasetId ?? null);
    if (resolved.missing.length) {
      return { farm, skip: { code: 'MISSING_VARIABLES', message: `Qiymat yo‘q: ${resolved.missing.join(', ')}` } };
    }
    for (const platform of passwordPlatforms) {
      const credential = get<{ secret_enc: string | null }>(
        'SELECT secret_enc FROM credentials WHERE farm_id = ? AND platform = ?',
        farm.id,
        platform,
      );
      if (!credential?.secret_enc) {
        return { farm, skip: { code: 'CREDENTIALS_MISSING', message: `${platform} uchun parol saqlanmagan` } };
      }
    }
    return { farm };
  });

  const skipped = planned.filter((item) => item.skip).length;
  const allSkipped = skipped === planned.length;
  const status: RunRow['status'] = allSkipped ? 'completed' : requiresApproval ? 'awaiting_approval' : 'running';

  db.exec('BEGIN');
  try {
    run(
      `INSERT INTO runs (id, scenario_id, scenario_version, dataset_id, mode, runner, status, total_farms, skipped_count,
        approved_at, started_at, finished_at, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      runId,
      scenario.id,
      scenario.current_version,
      input.datasetId ?? null,
      input.mode,
      runnerMode,
      status,
      planned.length,
      skipped,
      status === 'running' ? ts : null,
      allSkipped ? ts : null,
      allSkipped ? 'Barcha fermalar oldindan o‘tkazib yuborildi.' : null,
      ts,
    );

    for (const item of planned) {
      const id = crypto.randomUUID();
      if (item.skip) {
        run(
          `INSERT INTO run_farms (id, run_id, farm_id, status, started_at, finished_at, error_code, error_message, updated_at)
           VALUES (?, ?, ?, 'skipped', ?, ?, ?, ?, ?)`,
          id,
          runId,
          item.farm.id,
          ts,
          ts,
          item.skip.code,
          item.skip.message,
          ts,
        );
        emit(runId, 'farm_skipped', item.skip.message, item.skip, id);
      } else {
        run(
          `INSERT INTO run_farms (id, run_id, farm_id, status, updated_at) VALUES (?, ?, ?, 'queued', ?)`,
          id,
          runId,
          item.farm.id,
          ts,
        );
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  audit('buxgalter', 'run.created', 'run', runId, {
    scenario: scenario.name,
    version: scenario.current_version,
    farms: planned.length,
    mode: input.mode,
    runner: runnerMode,
  });
  emit(runId, 'run_created', `Run yaratildi: ${planned.length} ferma, ${input.mode === 'dry' ? 'dry run' : 'imzolash'}.`, {
    total: planned.length,
    skipped,
  });

  if (status === 'awaiting_approval') {
    emit(runId, 'run_awaiting_approval', 'Tasdiqlash kutilmoqda.');
  }
  if (status === 'completed') {
    emit(runId, 'run_completed', 'Barcha fermalar o‘tkazib yuborildi.', { skipped });
    audit('buxgalter', 'run.completed', 'run', runId, { skipped });
  }
  if (status === 'running') {
    emit(runId, 'run_started', 'Ijro boshlandi.');
    if (runnerMode === 'simulated') startSimulation(runId);
  }

  return getRun(runId);
}

export function approveRun(runId: string): RunRow {
  const row = getRun(runId);
  if (row.status !== 'awaiting_approval') throw new HttpError(409, 'NOT_AWAITING', 'Run tasdiqlash holatida emas.');
  const ts = now();
  run('UPDATE runs SET status = ?, approved_at = ?, started_at = ?, message = NULL WHERE id = ?', 'running', ts, ts, runId);
  emit(runId, 'run_approved', 'Buxgalter partiyani tasdiqladi (BR-03).');
  audit('buxgalter', 'run.approved', 'run', runId, { scenarioVersion: row.scenario_version });
  emit(runId, 'run_started', 'Ijro boshlandi.');
  if (row.runner === 'simulated') startSimulation(runId);
  return getRun(runId);
}

export function pauseRun(runId: string): RunRow {
  const row = getRun(runId);
  if (row.status !== 'running') throw new HttpError(409, 'NOT_RUNNING', 'Run ijro etilmayapti.');
  run('UPDATE runs SET status = ?, message = ? WHERE id = ?', 'paused', 'Buxgalter to‘xtatdi.', runId);
  emit(runId, 'run_paused', 'Run to‘xtatildi.');
  audit('buxgalter', 'run.paused', 'run', runId);
  return getRun(runId);
}

export function resumeRun(runId: string): RunRow {
  const row = getRun(runId);
  if (row.status !== 'paused') throw new HttpError(409, 'NOT_PAUSED', 'Run to‘xtatilmagan.');
  run('UPDATE runs SET status = ?, message = NULL WHERE id = ?', 'running', runId);
  emit(runId, 'run_resumed', 'Run davom ettirildi.');
  audit('buxgalter', 'run.resumed', 'run', runId);
  if (row.runner === 'simulated') startSimulation(runId);
  return getRun(runId);
}

export function cancelRun(runId: string): RunRow {
  const row = getRun(runId);
  if (!['running', 'paused', 'awaiting_approval'].includes(row.status)) {
    throw new HttpError(409, 'NOT_CANCELLABLE', 'Bu runni bekor qilib bo‘lmaydi.');
  }
  const ts = now();
  run(
    `UPDATE run_farms SET status = 'skipped', finished_at = ?, error_code = 'CANCELLED', error_message = 'Bekor qilindi',
     updated_at = ? WHERE run_id = ? AND status IN ('queued','running')`,
    ts,
    ts,
    runId,
  );
  run('UPDATE runs SET status = ?, finished_at = ?, message = ? WHERE id = ?', 'cancelled', ts, 'Bekor qilindi.', runId);
  emit(runId, 'run_cancelled', 'Run bekor qilindi.');
  audit('buxgalter', 'run.cancelled', 'run', runId);
  refreshCounts(runId);
  return getRun(runId);
}

export function retryFailed(runId: string): RunRow {
  const row = getRun(runId);
  if (['running', 'awaiting_approval'].includes(row.status)) {
    throw new HttpError(409, 'STILL_ACTIVE', 'Run hali faol.');
  }
  const failed = all<RunFarmRow>("SELECT * FROM run_farms WHERE run_id = ? AND status = 'error'", runId);
  if (failed.length === 0) throw new HttpError(409, 'NO_FAILURES', 'Xato bilan tugagan ferma yo‘q.');

  const ts = now();
  for (const farm of failed) {
    run(
      `UPDATE run_farms SET status = 'queued', started_at = NULL, finished_at = NULL, error_code = NULL,
       error_message = NULL, screenshot = NULL, updated_at = ? WHERE id = ?`,
      ts,
      farm.id,
    );
  }
  run('UPDATE runs SET status = ?, finished_at = NULL, message = NULL WHERE id = ?', 'running', runId);
  emit(runId, 'run_retry', `${failed.length} ferma qayta navbatga qo‘yildi.`);
  audit('buxgalter', 'run.retry_failed', 'run', runId, { count: failed.length });
  refreshCounts(runId);
  if (row.runner === 'simulated') startSimulation(runId);
  return getRun(runId);
}

export function refreshCounts(runId: string): void {
  const counts = all<{ status: string; count: number }>(
    'SELECT status, COUNT(*) AS count FROM run_farms WHERE run_id = ? GROUP BY status',
    runId,
  );
  const byStatus = new Map(counts.map((row) => [row.status, Number(row.count)]));
  run(
    'UPDATE runs SET done_count = ?, error_count = ?, skipped_count = ? WHERE id = ?',
    byStatus.get('done') ?? 0,
    byStatus.get('error') ?? 0,
    byStatus.get('skipped') ?? 0,
    runId,
  );
}

function finishIfDone(runId: string): boolean {
  const row = getRun(runId);
  if (row.status !== 'running') return false;
  const active = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM run_farms WHERE run_id = ? AND status IN ('queued','running')",
    runId,
  );
  if ((active?.count ?? 0) > 0) return false;

  const ts = now();
  run('UPDATE runs SET status = ?, finished_at = ?, message = ? WHERE id = ?', 'completed', ts, 'Yakunlandi.', runId);
  const fresh = getRun(runId);
  emit(runId, 'run_completed', `Run yakunlandi: ${fresh.done_count} bajarildi, ${fresh.error_count} xato, ${fresh.skipped_count} o‘tkazildi.`, {
    done: fresh.done_count,
    errors: fresh.error_count,
    skipped: fresh.skipped_count,
  });
  audit('buxgalter', 'run.completed', 'run', runId, {
    done: fresh.done_count,
    errors: fresh.error_count,
    skipped: fresh.skipped_count,
  });
  return true;
}

export function completeFarm(
  runFarmId: string,
  result: { ok: boolean; errorCode?: string; errorMessage?: string; screenshot?: string | null },
): void {
  const farm = get<RunFarmRow & { run_id: string }>('SELECT * FROM run_farms WHERE id = ?', runFarmId);
  if (!farm) return;
  const ts = now();
  if (result.ok) {
    run(
      "UPDATE run_farms SET status = 'done', finished_at = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?",
      ts,
      ts,
      runFarmId,
    );
    emit(farm.run_id, 'farm_done', 'Ferma muvaffaqiyatli bajarildi.', null, runFarmId);
  } else {
    run(
      "UPDATE run_farms SET status = 'error', finished_at = ?, updated_at = ?, error_code = ?, error_message = ?, screenshot = ? WHERE id = ?",
      ts,
      ts,
      result.errorCode ?? 'UNKNOWN',
      result.errorMessage ?? 'Noma’lum xato',
      result.screenshot ?? null,
      runFarmId,
    );
    emit(farm.run_id, 'farm_error', result.errorMessage ?? 'Noma’lum xato', { code: result.errorCode }, runFarmId);
  }
  refreshCounts(farm.run_id);

  const postSignUnclear = !result.ok && result.errorCode === 'POST_SIGN_UNCLEAR';
  const stopOnError = !result.ok && getSetting('stop_on_error') === '1';
  if (postSignUnclear || stopOnError) {
    const current = getRun(farm.run_id);
    if (current.status === 'running') {
      const message = postSignUnclear
        ? 'Imzolashdan keyin holat noaniq — buxgalter tekshirishi kerak (NFR-09).'
        : 'Xato sababli run to‘xtatildi — «xatoda to‘xtash» sozlamasi yoqilgan (BR-07).';
      run('UPDATE runs SET status = ?, message = ? WHERE id = ?', 'paused', message, farm.run_id);
      emit(farm.run_id, 'run_paused', message, { code: result.errorCode, reason: postSignUnclear ? 'post_sign' : 'stop_on_error' });
      audit('buxgalter', 'run.paused_on_error', 'run', farm.run_id, {
        code: result.errorCode,
        reason: postSignUnclear ? 'post_sign' : 'stop_on_error',
      });
    }
  }

  finishIfDone(farm.run_id);
}

async function waitWhilePaused(runId: string): Promise<boolean> {
  for (;;) {
    const status = getRun(runId).status;
    if (status === 'running') return true;
    if (status !== 'paused') return false;
    await sleep(250);
  }
}

async function simulationLoop(runId: string): Promise<void> {
  try {
    for (;;) {
      if (!(await waitWhilePaused(runId))) return;
      const row = getRun(runId);

      const next = get<RunFarmRow & { farm_name: string; farm_note: string | null }>(
        `SELECT rf.*, f.name AS farm_name, f.note AS farm_note FROM run_farms rf
         JOIN farms f ON f.id = rf.farm_id
         WHERE rf.run_id = ? AND rf.status = 'queued' ORDER BY rf.rowid LIMIT 1`,
        runId,
      );
      if (!next) {
        finishIfDone(runId);
        return;
      }

      const ts = now();
      run(
        "UPDATE run_farms SET status = 'running', started_at = ?, attempt = attempt + 1, updated_at = ? WHERE id = ?",
        ts,
        ts,
        next.id,
      );
      emit(runId, 'farm_started', `${next.farm_name} boshlandi.`, { farm: next.farm_name }, next.id);

      const scenario = scenarioOf(row);
      const steps = scenario.steps.filter((step) => step.enabled !== false);
      const totalMs = Math.max(env.simulatorDelayMs, steps.length * 320);
      const stepMs = Math.max(120, Math.floor(totalMs / Math.max(1, steps.length)));

      for (const step of steps) {
        if (!(await waitWhilePaused(runId))) return;
        const label = step.description || step.type;
        emit(runId, 'step', `${next.farm_name}: ${label}`, { step: step.id, type: step.type }, next.id);
        if (row.mode === 'dry' && (step.type === 'sign' || (step.type === 'click' && step.irreversible))) {
          emit(runId, 'step_skipped', `${next.farm_name}: imzolash qadami dry run’da o‘tkazildi.`, null, next.id);
        }
        await sleep(stepMs);
      }

      if (!(await waitWhilePaused(runId))) return;

      const fails = /demo-xato|xato/i.test(next.farm_note ?? '');
      completeFarm(next.id, fails
        ? { ok: false, errorCode: 'PAGE_UNEXPECTED', errorMessage: 'Kutilgan natija topilmadi (demo).' }
        : { ok: true });

      const after = getRun(runId);
      if (after.status === 'completed' || after.status === 'cancelled') return;
      const farmWaitMs = Math.max(0, Number(getSetting('farm_wait_seconds') ?? 3)) * 1000;
      await sleep(Math.max(200, Math.floor(env.simulatorDelayMs / 2), farmWaitMs));
    }
  } finally {
    simulating.delete(runId);
  }
}

export function repairInterruptedRuns(): void {
  const ts = now();
  const broken = all<{ id: string; run_id: string }>("SELECT id, run_id FROM run_farms WHERE status = 'running'");
  for (const farm of broken) {
    run(
      "UPDATE run_farms SET status = 'error', error_code = 'INTERRUPTED', error_message = 'Ilova yopildi — holat noaniq', finished_at = ?, updated_at = ? WHERE id = ?",
      ts,
      ts,
      farm.id,
    );
    emit(farm.run_id, 'farm_error', 'Ijro uzildi (ilova yopilgan). Holatni tekshiring.', { code: 'INTERRUPTED' }, farm.id);
  }
  for (const runId of new Set(broken.map((farm) => farm.run_id))) {
    refreshCounts(runId);
    finishIfDone(runId);
  }

  const stranded = all<{ id: string }>(
    "SELECT id FROM runs WHERE status = 'running' AND runner = 'simulated'",
  );
  for (const row of stranded) {
    startSimulation(row.id);
  }
}

export function startSimulation(runId: string): void {
  if (simulating.has(runId)) return;
  simulating.add(runId);
  void simulationLoop(runId).catch((error) => {
    console.error('simulation failed', error);
    run('UPDATE runs SET status = ?, message = ? WHERE id = ?', 'failed', 'Simulyatsiya xatosi.', runId);
    emit(runId, 'run_failed', 'Simulyatsiya xatosi.');
  });
}

export function runView(runId: string) {
  const row = getRun(runId);
  const scenario = scenarioOf(row);
  const farms = all<RunFarmRow & { farm_name: string; farm_tin: string; farm_note: string | null; one_c_url: string | null; key_valid_to: string | null }>(
    `SELECT rf.*, f.name AS farm_name, f.tin AS farm_tin, f.note AS farm_note, f.one_c_url, f.key_valid_to
     FROM run_farms rf JOIN farms f ON f.id = rf.farm_id
     WHERE rf.run_id = ? ORDER BY rf.rowid`,
    runId,
  );

  const review = farms.map((farm) => {
    const resolved = resolveVariables(
      scenario.variables,
      { id: farm.farm_id, name: farm.farm_name, tin: farm.farm_tin, one_c_url: farm.one_c_url },
      row.dataset_id,
    );
    return { runFarmId: farm.id, farmId: farm.farm_id, values: resolved.values, missing: resolved.missing };
  });

  const elapsedSeconds = row.started_at
    ? Math.max(0, Math.round(((row.finished_at ? new Date(row.finished_at) : new Date()).getTime() - new Date(row.started_at).getTime()) / 1000))
    : 0;
  const processed = row.done_count + row.error_count + row.skipped_count;

  return {
    run: {
      id: row.id,
      scenarioId: row.scenario_id,
      scenarioName: scenario.name,
      scenarioVersion: row.scenario_version,
      datasetId: row.dataset_id,
      mode: row.mode,
      runner: row.runner,
      status: row.status,
      totalFarms: row.total_farms,
      doneCount: row.done_count,
      errorCount: row.error_count,
      skippedCount: row.skipped_count,
      approvedAt: row.approved_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      message: row.message,
      createdAt: row.created_at,
      elapsedSeconds,
      progress: row.total_farms ? Math.round((processed / row.total_farms) * 100) : 0,
      hasIrreversible: hasIrreversible(scenario.steps),
      stepsCount: scenario.steps.length,
      requiresApproval: row.status === 'awaiting_approval',
    },
    farms: farms.map((farm) => ({
      id: farm.id,
      farmId: farm.farm_id,
      name: farm.farm_name,
      tin: farm.farm_tin,
      status: farm.status,
      startedAt: farm.started_at,
      finishedAt: farm.finished_at,
      errorCode: farm.error_code,
      errorMessage: farm.error_message,
      screenshot: farm.screenshot,
      attempt: farm.attempt,
      keyValidTo: farm.key_valid_to,
    })),
    review,
  };
}
