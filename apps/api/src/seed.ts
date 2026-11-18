import { all, db, get, now, run, setSetting } from './db.js';
import { shiftDayKey, tashkentDayKey, tashkentDayStart } from './lib/time.js';
import type { Step, Variable } from './lib/scenario.js';

const existing = get<{ count: number }>('SELECT COUNT(*) AS count FROM farms')?.count ?? 0;
if (existing > 0) {
  console.log(`Seed o‘tkazib yuborildi — ${existing} ferma allaqachon mavjud.`);
  process.exit(0);
}

interface FarmSeed {
  name: string;
  tin: string;
  group: string;
  note?: string;
  keyDays?: number | null;
}

const farms: FarmSeed[] = [
  { name: 'BIG WORLD RETAIL MCHJ', tin: '301234567', group: 'Savdo', keyDays: 240 },
  { name: 'DELTA AGRO MCHJ', tin: '302345678', group: 'Agro', keyDays: 180 },
  { name: 'GAMMA CHORVA MCHJ', tin: '303456789', group: 'Chorvachilik', keyDays: 90 },
  { name: 'ZARAFSHON DEHQON XO‘JALIGI', tin: '304567890', group: 'Dehqonchilik', keyDays: 365 },
  { name: 'SIRDARYO AGRO PLUS', tin: '305678901', group: 'Agro', keyDays: 15 },
  { name: 'QUYOSH ENERGIYA MCHJ', tin: '306789012', group: 'Savdo', keyDays: -10 },
  { name: 'NAVOIY DON MAHSULOTLARI', tin: '307890123', group: 'Dehqonchilik', keyDays: 200 },
  { name: 'XORAZM MEVA SAVDO', tin: '308901234', group: 'Savdo', keyDays: 300 },
  { name: 'FARG‘ONA PILLA KORXONASI', tin: '309012345', group: 'Chorvachilik', keyDays: 120, note: 'demo-xato' },
  { name: 'ANDIJON TEXNOPARK MCHJ', tin: '310123456', group: 'Agro', keyDays: 60 },
  { name: 'BUXORO TURIZM SERVIS', tin: '311234567', group: 'Xizmat', keyDays: null },
  { name: 'QASHQADARYO AGRO SERVIS', tin: '312345678', group: 'Agro', keyDays: 210 },
];

const ts = now();
const farmIds = new Map<string, string>();

db.exec('BEGIN');
try {
  for (const farm of farms) {
    const id = crypto.randomUUID();
    farmIds.set(farm.tin, id);
    const validTo = farm.keyDays == null ? null : new Date(Date.now() + farm.keyDays * 86_400_000).toISOString();
    run(
      `INSERT INTO farms (id, name, tin, group_name, note, status, key_subject, key_tin, key_valid_to, key_attached_at,
        consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      id,
      farm.name,
      farm.tin,
      farm.group,
      farm.note ?? null,
      validTo ? `${farm.name} rahbari` : null,
      validTo ? farm.tin : null,
      validTo,
      validTo ? ts : null,
      ts,
      ts,
      ts,
    );
  }

  const datasetId = crypto.randomUUID();
  run(
    'INSERT INTO datasets (id, name, source_name, columns_json, rows_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    datasetId,
    'Noyabr 2026 — oylik summalar',
    'demo-summalar.xlsx',
    JSON.stringify(['summa', 'izoh']),
    farms.length - 2,
    ts,
  );
  farms.forEach((farm, index) => {
    if (index >= farms.length - 2) return;
    run('INSERT INTO dataset_values (dataset_id, farm_tin, variable, value) VALUES (?, ?, ?, ?)', datasetId, farm.tin, 'summa', String(1_250_000 + index * 385_000));
    run('INSERT INTO dataset_values (dataset_id, farm_tin, variable, value) VALUES (?, ?, ?, ?)', datasetId, farm.tin, 'izoh', 'Noyabr 2026 xizmat haqi');
  });

  const scenarios: Array<{ name: string; platform: string; folder: string; steps: Step[]; variables: Variable[] }> = [
    {
      name: 'Didox — schyot-faktura qoralamasi',
      platform: 'didox',
      folder: 'Didox',
      variables: [
        { name: 'summa', label: 'Summa', source: 'dataset' },
        { name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' },
      ],
      steps: [
        { id: crypto.randomUUID(), type: 'navigate', url: 'https://didox.uz', description: 'Didox sahifasini ochish' },
        { id: crypto.randomUUID(), type: 'eimzo-login', platform: 'didox', description: 'E-IMZO kaliti bilan kirish' },
        { id: crypto.randomUUID(), type: 'click', selector: 'a[href="/documents"]', description: '«Hujjatlar» bo‘limini ochish' },
        { id: crypto.randomUUID(), type: 'fill', selector: 'input[name="summa"]', value: '', variable: 'summa', description: 'Summani kiritish' },
        { id: crypto.randomUUID(), type: 'sign', selector: 'button[data-action="save-draft"]', description: 'Qoralamani saqlash (imzo emas)' },
        { id: crypto.randomUUID(), type: 'check', text: 'Қоралама', description: 'Qoralama ro‘yxatda ko‘rindi' },
      ],
    },
    {
      name: '1C E-aktiv — elektron hujjatlar',
      platform: '1c',
      folder: '1C',
      variables: [{ name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' }],
      steps: [
        { id: crypto.randomUUID(), type: 'navigate', url: 'https://1c.uz', description: '1C veb-mijozni ochish' },
        { id: crypto.randomUUID(), type: 'eimzo-login', platform: '1c', description: 'ERI bilan kirish' },
        { id: crypto.randomUUID(), type: 'click', selector: '[data-section="documents"]', description: '«Электронные документы» bo‘limi' },
        { id: crypto.randomUUID(), type: 'check', text: 'Электронные документы', description: 'Bo‘lim ochildi' },
      ],
    },
    {
      name: 'My3 Soliq — soliq deklaratsiyasi',
      platform: 'my3',
      folder: 'Soliq',
      variables: [{ name: 'summa', label: 'Summa', source: 'dataset' }],
      steps: [
        { id: crypto.randomUUID(), type: 'navigate', url: 'https://my3.soliq.uz', description: 'My3 Soliq kabinetini ochish' },
        { id: crypto.randomUUID(), type: 'eimzo-login', platform: 'my3', description: 'E-IMZO bilan kirish' },
        { id: crypto.randomUUID(), type: 'click', selector: '[data-menu="reports"]', description: '«Hisobotlar» menyusi' },
        { id: crypto.randomUUID(), type: 'fill', selector: 'input[name="amount"]', value: '', variable: 'summa', description: 'Summani kiritish' },
        { id: crypto.randomUUID(), type: 'check', text: 'Юбориш', description: 'Yuborish tugmasi ko‘rindi' },
      ],
    },
    {
      name: 'E-ijara — ijara shartnomasi tekshiruvi',
      platform: 'eijara',
      folder: 'E-ijara',
      variables: [{ name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' }],
      steps: [
        { id: crypto.randomUUID(), type: 'navigate', url: 'https://eijara.soliq.uz', description: 'E-ijara tizimini ochish' },
        { id: crypto.randomUUID(), type: 'eimzo-login', platform: 'eijara', description: 'E-IMZO bilan kirish' },
        { id: crypto.randomUUID(), type: 'click', selector: 'a[href="/contracts"]', description: '«Shartnomalar» ro‘yxati' },
        { id: crypto.randomUUID(), type: 'check', text: 'Шартнома', description: 'Shartnomalar ro‘yxati ochildi' },
      ],
    },
  ];

  for (const scenario of scenarios) {
    const id = crypto.randomUUID();
    run(
      `INSERT INTO scenarios (id, name, platform, folder, description, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      scenario.name,
      scenario.platform,
      scenario.folder,
      'Demo scenario — real ishda qayta yozib olinadi.',
      ts,
      ts,
    );
    run(
      `INSERT INTO scenario_versions (id, scenario_id, version, steps_json, variables_json, note, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      id,
      JSON.stringify(scenario.steps),
      JSON.stringify(scenario.variables),
      'Demo versiya',
      ts,
    );
  }

  setSetting('runner_mode', 'simulated');
  setSetting('manual_minutes_per_farm', '12');
  setSetting('farm_wait_seconds', '3');
  setSetting('stop_on_error', '0');

  seedHistory(datasetId);
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

function seedHistory(datasetId: string): void {
  const scenarioRows = all<{ id: string; platform: string }>('SELECT id, platform FROM scenarios ORDER BY rowid');
  const farmRows = all<{ id: string; name: string; tin: string; key_valid_to: string | null }>(
    'SELECT id, name, tin, key_valid_to FROM farms ORDER BY rowid',
  );
  if (scenarioRows.length === 0 || farmRows.length === 0) return;

  let state = 20261118;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  const todayKey = tashkentDayKey();
  let historyRuns = 0;

  const addEvent = (runId: string, farmId: string | null, timestamp: number, type: string, message: string) => {
    run(
      'INSERT INTO run_events (run_id, run_farm_id, ts, type, message, data_json) VALUES (?, ?, ?, ?, ?, NULL)',
      runId,
      farmId,
      new Date(timestamp).toISOString(),
      type,
      message,
    );
  };

  const addAudit = (timestamp: number, action: string, entity: string, entityId: string, detail: object) => {
    run(
      'INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
      new Date(timestamp).toISOString(),
      'buxgalter',
      action,
      entity,
      entityId,
      JSON.stringify(detail),
    );
  };

  for (let offset = -6; offset <= 0; offset += 1) {
    const dayKey = shiftDayKey(todayKey, offset);
    const runsPerDay = offset === 0 ? 2 : offset === -3 ? 2 : 1;
    for (let index = 0; index < runsPerDay; index += 1) {
      const scenario = scenarioRows[Math.floor(rand() * scenarioRows.length)]!;
      const pool = [...farmRows].sort(() => rand() - 0.5);
      const selected = pool.slice(0, 4 + Math.floor(rand() * 3));
      const withError = offset === -2 && index === 0;

      const dayHead = tashkentDayStart(dayKey).getTime();
      let startMs =
        dayHead + (9 + Math.floor(rand() * 5)) * 3_600_000 + index * 2 * 3_600_000 + Math.floor(rand() * 20) * 60_000;
      if (offset === 0) {
        const latest = Date.now() - 20 * 60_000;
        startMs = Math.min(startMs, latest - 35 * 60_000);
        if (startMs < dayHead + 5 * 60_000) continue;
      }

      const runId = crypto.randomUUID();
      const createdMs = startMs - 55_000;
      addAudit(createdMs, 'run.created', 'run', runId, { scenarioId: scenario.id, farms: selected.length });

      let cursor = startMs;
      let done = 0;
      let errors = 0;
      let skipped = 0;
      const farmPlan: Array<{ farmId: string; status: 'done' | 'error' | 'skipped'; start: number; end: number; errorMessage?: string }> = [];

      for (const farm of selected) {
        const farmStart = cursor;
        if (!farm.key_valid_to) {
          farmPlan.push({ farmId: farm.id, status: 'skipped', start: farmStart, end: farmStart, errorMessage: 'E-IMZO kaliti biriktirilmagan.' });
          skipped += 1;
          continue;
        }
        const duration = 3_000 + Math.floor(rand() * 4_000);
        const farmEnd = farmStart + duration;
        const isError = withError && farmPlan.filter((plan) => plan.status === 'error').length === 0 && done >= 1;
        farmPlan.push({
          farmId: farm.id,
          status: isError ? 'error' : 'done',
          start: farmStart,
          end: farmEnd,
          errorMessage: isError ? 'Kutilgan natija topilmadi (demo).' : undefined,
        });
        if (isError) errors += 1;
        else done += 1;
        cursor = farmEnd + 1_500;
      }

      const finishedMs = cursor;
      run(
        `INSERT INTO runs (id, scenario_id, scenario_version, dataset_id, mode, runner, status, total_farms,
          done_count, error_count, skipped_count, approved_at, started_at, finished_at, message, created_at)
         VALUES (?, ?, 1, ?, ?, 'simulated', 'completed', ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        runId,
        scenario.id,
        datasetId,
        index === 1 ? 'live' : 'dry',
        selected.length,
        done,
        errors,
        skipped,
        index === 1 ? new Date(createdMs).toISOString() : null,
        new Date(startMs).toISOString(),
        new Date(finishedMs).toISOString(),
        new Date(createdMs).toISOString(),
      );

      addEvent(runId, null, startMs, 'run_started', 'Run boshlandi.');
      for (const plan of farmPlan) {
        const farm = selected.find((item) => item.id === plan.farmId)!;
        const runFarmId = crypto.randomUUID();
        run(
          `INSERT INTO run_farms (id, run_id, farm_id, status, started_at, finished_at, error_code, error_message, attempt, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          runFarmId,
          runId,
          plan.farmId,
          plan.status,
          new Date(plan.start).toISOString(),
          plan.status === 'skipped' ? null : new Date(plan.end).toISOString(),
          plan.status === 'error' ? 'PAGE_UNEXPECTED' : plan.status === 'skipped' ? 'EIMZO_KEY_MISSING' : null,
          plan.errorMessage ?? null,
          new Date(plan.status === 'skipped' ? plan.start : plan.end).toISOString(),
        );
        addEvent(runId, runFarmId, plan.start, 'farm_started', `${farm.name} boshlandi.`);
        addEvent(runId, runFarmId, plan.start + 1_000, 'step', `${farm.name}: summa kiritilmoqda`);
        if (plan.status === 'done') {
          addEvent(runId, runFarmId, plan.end, 'farm_done', `${farm.name} bajarildi.`);
        } else if (plan.status === 'error') {
          addEvent(runId, runFarmId, plan.end, 'farm_error', `${farm.name}: kutilgan natija topilmadi.`);
        } else {
          addEvent(runId, runFarmId, plan.end, 'farm_skipped', `${farm.name} o‘tkazib yuborildi: kalit yo‘q.`);
        }
      }
      addEvent(runId, null, finishedMs, 'run_completed', 'Run yakunlandi.');
      addAudit(finishedMs, 'run.completed', 'run', runId, { done, errors, skipped });
      historyRuns += 1;
    }
  }

  console.log(`Demo tarix: ${historyRuns} run (7 kun, Toshkent vaqti).`);
}

console.log(
  `Seed tayyor: ${farms.length} ferma, ${all('SELECT id FROM scenarios').length} scenario, 1 dataset, ${all('SELECT id FROM runs').length} demo run.`,
);
