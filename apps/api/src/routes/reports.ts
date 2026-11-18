import { Router } from 'express';
import ExcelJS from 'exceljs';
import { all, get } from '../db.js';
import { HttpError } from '../lib/http.js';
import { shiftDayKey, tashkentDateTime, tashkentDayEnd, tashkentDayKey, tashkentDayStart } from '../lib/time.js';
import { runView } from '../services/runs.js';

export const reportsRouter = Router();

reportsRouter.get('/runs', (req, res) => {
  const todayKey = tashkentDayKey();
  const to = String(req.query.to ?? tashkentDayEnd(todayKey).toISOString());
  const from = String(req.query.from ?? tashkentDayStart(shiftDayKey(todayKey, -29)).toISOString());
  const rows = all<{
    id: string;
    scenario_name: string;
    scenario_version: number;
    mode: string;
    runner: string;
    status: string;
    total_farms: number;
    done_count: number;
    error_count: number;
    skipped_count: number;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
  }>(
    `SELECT r.*, s.name AS scenario_name FROM runs r JOIN scenarios s ON s.id = r.scenario_id
     WHERE r.created_at >= ? AND r.created_at <= ? ORDER BY r.created_at DESC`,
    from,
    to,
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.runs += 1;
      acc.farms += row.total_farms;
      acc.done += row.done_count;
      acc.errors += row.error_count;
      acc.skipped += row.skipped_count;
      return acc;
    },
    { runs: 0, farms: 0, done: 0, errors: 0, skipped: 0 },
  );

  res.json({
    from,
    to,
    totals,
    runs: rows.map((row) => ({
      id: row.id,
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

reportsRouter.get('/runs/:id/export.xlsx', async (req, res) => {
  const exists = get<{ id: string }>('SELECT id FROM runs WHERE id = ?', req.params.id);
  if (!exists) throw new HttpError(404, 'NOT_FOUND', 'Run topilmadi.');

  const view = runView(req.params.id);
  const scenario = get<{ variables_json: string }>(
    `SELECT v.variables_json FROM runs r JOIN scenario_versions v
     ON v.scenario_id = r.scenario_id AND v.version = r.scenario_version WHERE r.id = ?`,
    req.params.id,
  );
  const variables = scenario ? (JSON.parse(scenario.variables_json) as Array<{ name: string; label: string }>) : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Buxgalter RPA';
  const summary = workbook.addWorksheet('Xulosa');
  summary.columns = [
    { header: 'Ko‘rsatkich', key: 'label', width: 32 },
    { header: 'Qiymat', key: 'value', width: 42 },
  ];
  const rows: Array<[string, string | number]> = [
    ['Run ID', view.run.id],
    ['Scenario', `${view.run.scenarioName} (v${view.run.scenarioVersion})`],
    ['Rejim', view.run.mode === 'dry' ? 'Dry run' : 'Imzolash'],
    ['Ijrochi', view.run.runner === 'desktop' ? 'Desktop robot' : 'Simulyatsiya'],
    ['Holat', view.run.status],
    ['Fermalar', view.run.totalFarms],
    ['Bajarildi', view.run.doneCount],
    ['Xato', view.run.errorCount],
    ['O‘tkazib yuborildi', view.run.skippedCount],
    ['Boshlandi (Toshkent)', tashkentDateTime(view.run.startedAt)],
    ['Tugadi (Toshkent)', tashkentDateTime(view.run.finishedAt)],
    ['Davomiylik (soniya)', view.run.elapsedSeconds],
  ];
  rows.forEach(([label, value]) => summary.addRow({ label, value }));
  summary.getRow(1).font = { bold: true };

  const farmsSheet = workbook.addWorksheet('Fermalar');
  farmsSheet.columns = [
    { header: '№', key: 'index', width: 6 },
    { header: 'Ferma', key: 'name', width: 34 },
    { header: 'STIR', key: 'tin', width: 14 },
    { header: 'Holat', key: 'status', width: 12 },
    { header: 'Boshlandi (Toshkent)', key: 'startedAt', width: 22 },
    { header: 'Tugadi (Toshkent)', key: 'finishedAt', width: 22 },
    { header: 'Urinish', key: 'attempt', width: 10 },
    { header: 'Xato kodi', key: 'errorCode', width: 20 },
    { header: 'Xato', key: 'errorMessage', width: 46 },
    ...variables.map((variable) => ({ header: variable.label || variable.name, key: `var_${variable.name}`, width: 20 })),
  ];

  view.farms.forEach((farm, index) => {
    const review = view.review.find((item) => item.runFarmId === farm.id);
    const record: Record<string, string | number> = {
      index: index + 1,
      name: farm.name,
      tin: farm.tin,
      status: farm.status,
      startedAt: tashkentDateTime(farm.startedAt),
      finishedAt: tashkentDateTime(farm.finishedAt),
      attempt: farm.attempt,
      errorCode: farm.errorCode ?? '',
      errorMessage: farm.errorMessage ?? '',
    };
    for (const variable of variables) {
      record[`var_${variable.name}`] = review?.values[variable.name] ?? '';
    }
    farmsSheet.addRow(record);
  });
  farmsSheet.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="run-${view.run.id.slice(0, 8)}.xlsx"`);
  const buffer = await workbook.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
});
