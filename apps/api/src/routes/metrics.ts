import { Router } from 'express';
import { all, get, getSetting } from '../db.js';
import { shiftDayKey, tashkentDayEnd, tashkentDayKey, tashkentDayStart } from '../lib/time.js';

export const metricsRouter = Router();

metricsRouter.get('/', (_req, res) => {
  const todayKey = tashkentDayKey();
  const dayStart = tashkentDayStart(todayKey);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const farmCounts = all<{ status: string; count: number }>('SELECT status, COUNT(*) AS count FROM farms GROUP BY status');
  const farmByStatus = new Map(farmCounts.map((row) => [row.status, Number(row.count)]));
  const totalFarms = farmCounts.reduce((sum, row) => sum + Number(row.count), 0);

  const keyRows = all<{ key_valid_to: string | null; tin: string; name: string; key_tin: string | null }>(
    'SELECT key_valid_to, tin, name, key_tin FROM farms WHERE status = ?',
    'active',
  );
  let keysExpiring = 0;
  let keysExpired = 0;
  let missingKeys = 0;
  const keyAlerts: Array<{ farmName: string; tin: string; validTo: string | null; daysLeft: number | null; status: string }> = [];
  for (const row of keyRows) {
    if (!row.key_valid_to) {
      missingKeys += 1;
      continue;
    }
    const daysLeft = Math.ceil((new Date(row.key_valid_to).getTime() - Date.now()) / 86_400_000);
    if (daysLeft < 0) keysExpired += 1;
    else if (daysLeft <= 30) keysExpiring += 1;
    if (daysLeft <= 30) {
      keyAlerts.push({
        farmName: row.name,
        tin: row.tin,
        validTo: row.key_valid_to,
        daysLeft,
        status: daysLeft < 0 ? 'expired' : 'expiring',
      });
    }
  }
  keyAlerts.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  const credentialPlatforms = all<{ platform: string; farms: number }>(
    'SELECT platform, COUNT(DISTINCT farm_id) AS farms FROM credentials WHERE secret_enc IS NOT NULL GROUP BY platform',
  );
  const runPlatforms = all<{ platform: string; runs: number }>(
    `SELECT s.platform, COUNT(*) AS runs FROM run_farms rf
     JOIN runs r ON r.id = rf.run_id JOIN scenarios s ON s.id = r.scenario_id
     GROUP BY s.platform`,
  );
  const platformMap = new Map<string, { platform: string; farms: number; runs: number }>();
  for (const row of credentialPlatforms) {
    platformMap.set(row.platform, { platform: row.platform, farms: Number(row.farms), runs: 0 });
  }
  for (const row of runPlatforms) {
    const item = platformMap.get(row.platform) ?? { platform: row.platform, farms: 0, runs: 0 };
    item.runs = Number(row.runs);
    platformMap.set(row.platform, item);
  }
  const platformRows = [...platformMap.values()];

  const todayRuns = get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM runs WHERE created_at >= ?',
    dayStart.toISOString(),
  )?.count ?? 0;

  const last30 = get<{ done: number; errors: number; skipped: number }>(
    `SELECT
       SUM(CASE WHEN rf.status = 'done' THEN 1 ELSE 0 END) AS done,
       SUM(CASE WHEN rf.status = 'error' THEN 1 ELSE 0 END) AS errors,
       SUM(CASE WHEN rf.status = 'skipped' THEN 1 ELSE 0 END) AS skipped
     FROM run_farms rf JOIN runs r ON r.id = rf.run_id
     WHERE rf.finished_at >= ?`,
    since30,
  );
  const done = Number(last30?.done ?? 0);
  const errors = Number(last30?.errors ?? 0);
  const skipped = Number(last30?.skipped ?? 0);
  const attempts = done + errors;
  const successRate = attempts ? Math.round((done / attempts) * 1000) / 10 : 0;

  const manualInterventions = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM run_events WHERE type = 'manual_required' AND ts >= ?",
    since30,
  )?.count ?? 0;
  const unattendedRate = done + errors + manualInterventions
    ? Math.round((done / (done + errors + manualInterventions)) * 1000) / 10
    : 0;

  const avgFarmSeconds = get<{ avg: number | null }>(
    `SELECT AVG((julianday(rf.finished_at) - julianday(rf.started_at)) * 86400) AS avg
     FROM run_farms rf WHERE rf.status = 'done' AND rf.finished_at >= ? AND rf.started_at IS NOT NULL`,
    since30,
  )?.avg ?? null;

  const actualSeconds = get<{ total: number | null }>(
    `SELECT SUM((julianday(COALESCE(finished_at, started_at)) - julianday(started_at)) * 86400) AS total
     FROM runs WHERE started_at IS NOT NULL AND created_at >= ?`,
    since30,
  )?.total ?? 0;
  const manualMinutes = Number(getSetting('manual_minutes_per_farm') ?? 12);
  const savedMinutes = Math.max(0, Math.round(done * manualMinutes - Number(actualSeconds ?? 0) / 60));

  const recentRuns = all<{
    id: string;
    scenario_name: string;
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
     ORDER BY r.created_at DESC LIMIT 6`,
  ).map((row) => ({
    id: row.id,
    scenarioName: row.scenario_name,
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
  }));

  const active = get<{
    id: string;
    scenario_name: string;
    mode: string;
    runner: string;
    status: string;
    total_farms: number;
    done_count: number;
    error_count: number;
    skipped_count: number;
    started_at: string | null;
  }>(
    `SELECT r.*, s.name AS scenario_name FROM runs r JOIN scenarios s ON s.id = r.scenario_id
     WHERE r.status IN ('running','paused','awaiting_approval') ORDER BY r.created_at DESC LIMIT 1`,
  );

  const runningRuns = get<{ count: number }>("SELECT COUNT(*) AS count FROM runs WHERE status = 'running'")?.count ?? 0;

  const series: Array<{ date: string; done: number; error: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = shiftDayKey(todayKey, -i);
    const row = get<{ done: number; error: number }>(
      `SELECT SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error
       FROM run_farms WHERE finished_at >= ? AND finished_at < ?`,
      tashkentDayStart(key).toISOString(),
      tashkentDayEnd(key).toISOString(),
    );
    series.push({ date: key, done: Number(row?.done ?? 0), error: Number(row?.error ?? 0) });
  }

  res.json({
    farms: {
      total: totalFarms,
      active: farmByStatus.get('active') ?? 0,
      archived: farmByStatus.get('archived') ?? 0,
      withKey: keyRows.filter((row) => row.key_valid_to).length,
      missingKey: missingKeys,
    },
    keys: { expiring: keysExpiring, expired: keysExpired, alerts: keyAlerts.slice(0, 8) },
    runsToday: Number(todayRuns),
    runningRuns: Number(runningRuns),
    activeRun: active
      ? {
          id: active.id,
          scenarioName: active.scenario_name,
          mode: active.mode,
          runner: active.runner,
          status: active.status,
          totalFarms: active.total_farms,
          doneCount: active.done_count,
          errorCount: active.error_count,
          skippedCount: active.skipped_count,
          progress: active.total_farms
            ? Math.round(((active.done_count + active.error_count + active.skipped_count) / active.total_farms) * 100)
            : 0,
          done: active.done_count,
          errors: active.error_count,
          total: active.total_farms,
          startedAt: active.started_at,
        }
      : null,
    last30: {
      done,
      errors,
      skipped,
      successRate,
      unattendedRate,
      avgFarmSeconds: avgFarmSeconds ? Math.round(Number(avgFarmSeconds) * 10) / 10 : null,
      manualInterventions: Number(manualInterventions),
    },
    timeSaved: {
      manualMinutesPerFarm: manualMinutes,
      actualMinutes: Math.round(Number(actualSeconds ?? 0) / 60),
      savedMinutes,
    },
    platforms: platformRows,
    recentRuns,
    series,
    totals: {
      scenarios: get<{ count: number }>('SELECT COUNT(*) AS count FROM scenarios WHERE status = ?', 'active')?.count ?? 0,
      datasets: get<{ count: number }>('SELECT COUNT(*) AS count FROM datasets')?.count ?? 0,
    },
    runnerMode: getSetting('runner_mode') ?? 'simulated',
  });
});
