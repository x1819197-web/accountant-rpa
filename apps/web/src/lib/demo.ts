import type {
  AuditEntry,
  Credential,
  Dataset,
  DatasetCoverage,
  Farm,
  FarmRunStatus,
  KeyInfo,
  Metrics,
  Platform,
  RunEvent,
  RunFarm,
  RunReview,
  RunStatus,
  RunSummary,
  RunView,
  Scenario,
  ScenarioDetail,
  Settings,
  Step,
  Variable,
} from './types';

const OFFSET = 5 * 3_600_000;
const STEP_MS = 800;
const STEPS_PER_FARM = 4;

export class DemoError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const nowIso = () => new Date().toISOString();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();

const dayKey = (date: Date = new Date()) => new Date(date.getTime() + OFFSET).toISOString().slice(0, 10);
const dayStart = (key: string) => new Date(`${key}T00:00:00+05:00`);
const shiftDay = (key: string, days: number) =>
  new Date(dayStart(key).getTime() + days * 86_400_000 + OFFSET).toISOString().slice(0, 10);

let eventSeq = 1;

function countSteps(steps: Step[]): number {
  let total = 0;
  for (const step of steps) {
    total += 1;
    if (step.type === 'loop') total += countSteps(step.steps);
    if (step.type === 'condition') total += countSteps(step.then) + countSteps(step.otherwise);
  }
  return total;
}

function hasIrreversible(steps: Step[]): boolean {
  for (const step of steps) {
    if (step.type === 'sign') return true;
    if (step.type === 'click' && step.irreversible) return true;
    if (step.type === 'loop' && hasIrreversible(step.steps)) return true;
    if (step.type === 'condition' && (hasIrreversible(step.then) || hasIrreversible(step.otherwise))) return true;
  }
  return false;
}

type StepDraft = Step extends infer S ? (S extends Step ? Omit<S, 'id'> : never) : never;
const step = <T extends Step>(value: T extends Step ? Omit<T, 'id'> : never): Step => ({ ...value, id: uuid() } as Step);

function makeSteps(kind: 'didox' | 'extract' | '1c' | 'my3' | 'eijara'): Step[] {
  if (kind === 'didox') {
    return [
      step({ type: 'navigate', url: 'https://didox.uz', description: 'Didox sahifasini ochish' }),
      step({ type: 'eimzo-login', platform: 'didox', description: 'E-IMZO kaliti bilan kirish' }),
      step({ type: 'click', selector: 'a[href="/documents"]', description: '«Hujjatlar» bo‘limini ochish' }),
      step({ type: 'fill', selector: 'input[name="summa"]', value: '', variable: 'summa', description: 'Summani kiritish' }),
      step({ type: 'sign', selector: 'button[data-action="save-draft"]', description: 'Qoralamani saqlash' }),
      step({ type: 'check', text: 'Қоралама', description: 'Qoralama ro‘yxatda ko‘rindi' }),
    ];
  }
  if (kind === 'extract') {
    return [
      step({ type: 'navigate', url: 'https://didox.uz', description: 'Didox sahifasini ochish' }),
      step({ type: 'eimzo-login', platform: 'didox', description: 'E-IMZO kaliti bilan kirish' }),
      step({ type: 'click', selector: 'a[href="/documents"]', description: '«Hujjatlar» bo‘limini ochish' }),
      step({ type: 'click', selector: '#new-doc', description: 'Yangi hujjat formasini ochish' }),
      step({ type: 'fill', selector: '#summa', value: '', variable: 'summa', description: 'Summani kiritish' }),
      step({ type: 'click', selector: '[data-action="save-draft"]', description: 'Qoralamani saqlash' }),
      step({ type: 'extract', selector: '#docs-table tbody tr td:nth-child(2)', variable: 'doc_no', attribute: 'text', description: 'Hujjat raqamini olish' }),
      step({ type: 'check', text: 'Қоралама', description: 'Qoralama ro‘yxatda ko‘rindi' }),
    ];
  }
  if (kind === '1c') {
    return [
      step({ type: 'navigate', url: 'https://1c.uz', description: '1C veb-mijozni ochish' }),
      step({ type: 'eimzo-login', platform: '1c', description: 'ERI bilan kirish' }),
      step({ type: 'click', selector: '[data-section="documents"]', description: '«Электронные документы» bo‘limi' }),
      step({ type: 'check', text: 'Электронные документы', description: 'Bo‘lim ochildi' }),
    ];
  }
  if (kind === 'my3') {
    return [
      step({ type: 'navigate', url: 'https://my3.soliq.uz', description: 'My3 Soliq kabinetini ochish' }),
      step({ type: 'eimzo-login', platform: 'my3', description: 'E-IMZO bilan kirish' }),
      step({ type: 'click', selector: '[data-menu="reports"]', description: '«Hisobotlar» menyusi' }),
      step({ type: 'fill', selector: 'input[name="amount"]', value: '', variable: 'summa', description: 'Summani kiritish' }),
      step({ type: 'check', text: 'Юбориш', description: 'Yuborish tugmasi ko‘rindi' }),
    ];
  }
  return [
    step({ type: 'navigate', url: 'https://eijara.soliq.uz', description: 'E-ijara tizimini ochish' }),
    step({ type: 'eimzo-login', platform: 'eijara', description: 'E-IMZO bilan kirish' }),
    step({ type: 'click', selector: 'a[href="/contracts"]', description: '«Shartnomalar» ro‘yxati' }),
    step({ type: 'check', text: 'Шартнома', description: 'Shartnomalar ro‘yxati ochildi' }),
  ];
}

interface DemoScenario {
  scenario: Scenario;
  steps: Step[];
  variables: Variable[];
  versions: Array<{ version: number; note: string | null; createdAt: string }>;
}

interface DemoDataset {
  dataset: Dataset;
  values: Map<string, Record<string, string>>;
}

interface DemoRun {
  run: RunSummary;
  farms: RunFarm[];
  review: RunReview[];
  events: RunEvent[];
  stepProgress: number;
  timer: ReturnType<typeof setInterval> | null;
}

interface DemoState {
  unlocked: boolean;
  settings: Settings;
  farms: Farm[];
  scenarios: DemoScenario[];
  datasets: DemoDataset[];
  runs: DemoRun[];
  audit: AuditEntry[];
  token: string;
}

const FARM_SEEDS: Array<{ name: string; tin: string; group: string; note?: string; keyDays?: number | null }> = [
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

function makeKey(tin: string, name: string, keyDays: number | null | undefined): KeyInfo {
  if (keyDays == null) {
    return { attached: false, subject: null, tin: null, validTo: null, attachedAt: null, status: 'missing', daysLeft: null, tinMismatch: false };
  }
  const validTo = new Date(Date.now() + keyDays * 86_400_000).toISOString();
  const daysLeft = Math.ceil((Date.parse(validTo) - Date.now()) / 86_400_000);
  const status: KeyInfo['status'] = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'ok';
  return {
    attached: true,
    subject: `${name} rahbari`,
    tin,
    validTo,
    attachedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    status,
    daysLeft,
    tinMismatch: false,
  };
}

function makeCredentials(): Credential[] {
  const ts = new Date(Date.now() - 10 * 86_400_000).toISOString();
  return [
    { platform: 'didox', login: 'buxgalter@demo.uz', hasPassword: true, hasEriPassword: true, updatedAt: ts },
    { platform: '1c', login: 'buxgalter', hasPassword: true, hasEriPassword: false, updatedAt: ts },
  ];
}

function makeFarms(): Farm[] {
  return FARM_SEEDS.map((seed) => {
    const createdAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
    return {
      id: uuid(),
      name: seed.name,
      tin: seed.tin,
      groupName: seed.group,
      note: seed.note ?? null,
      status: 'active',
      oneCUrl: `https://1c.demo.uz/${seed.tin}`,
      consentAt: createdAt,
      key: makeKey(seed.tin, seed.name, seed.keyDays),
      createdAt,
      updatedAt: createdAt,
      credentials: makeCredentials(),
    };
  });
}

function makeScenarios(): DemoScenario[] {
  const created = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const definitions: Array<{ kind: 'didox' | 'extract' | '1c' | 'my3' | 'eijara'; name: string; platform: Platform; folder: string; variables: Variable[]; description: string }> = [
    {
      kind: 'didox',
      name: 'Didox — schyot-faktura qoralamasi',
      platform: 'didox',
      folder: 'Didox',
      description: 'E-IMZO bilan kirish, summani kiritish va qoralama saqlash.',
      variables: [
        { name: 'summa', label: 'Summa', source: 'dataset' },
        { name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' },
      ],
    },
    {
      kind: 'extract',
      name: 'Didox — hujjat raqamini olish (demo)',
      platform: 'didox',
      folder: 'Didox',
      description: 'Yaratilgan hujjat raqamini o‘qib, keyingi qadamlarda {{doc_no}} sifatida ishlatadi.',
      variables: [
        { name: 'summa', label: 'Summa', source: 'dataset' },
        { name: 'doc_no', label: 'Hujjat raqami', source: 'constant' },
      ],
    },
    {
      kind: '1c',
      name: '1C E-aktiv — elektron hujjatlar',
      platform: '1c',
      folder: '1C',
      description: '1C veb-mijozda elektron hujjatlar bo‘limini tekshirish.',
      variables: [{ name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' }],
    },
    {
      kind: 'my3',
      name: 'My3 Soliq — soliq deklaratsiyasi',
      platform: 'my3',
      folder: 'Soliq',
      description: 'Deklaratsiya summasini kiritish va yuborish tugmasini tekshirish.',
      variables: [{ name: 'summa', label: 'Summa', source: 'dataset' }],
    },
    {
      kind: 'eijara',
      name: 'E-ijara — ijara shartnomasi tekshiruvi',
      platform: 'eijara',
      folder: 'E-ijara',
      description: 'Ijara shartnomalari ro‘yxatini tekshirish.',
      variables: [{ name: 'sana', label: 'Sana', source: 'system', systemKey: 'date' }],
    },
  ];

  return definitions.map((definition, index) => {
    const steps = makeSteps(definition.kind);
    const updatedAt = new Date(Date.now() - index * 86_400_000).toISOString();
    return {
      scenario: {
        id: uuid(),
        name: definition.name,
        platform: definition.platform,
        folder: definition.folder,
        description: definition.description,
        status: 'active',
        version: 1,
        stepsCount: countSteps(steps),
        hasIrreversible: hasIrreversible(steps),
        createdAt: created,
        updatedAt,
      },
      steps,
      variables: definition.variables,
      versions: [{ version: 1, note: 'Demo versiya', createdAt: created }],
    };
  });
}

function makeDatasets(farms: Farm[]): DemoDataset[] {
  const dataset: Dataset = {
    id: uuid(),
    name: 'Noyabr 2026 — oylik summalar',
    sourceName: 'demo-summalar.xlsx',
    columns: ['summa', 'izoh'],
    rowsCount: farms.length - 2,
    createdAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
  };
  const values = new Map<string, Record<string, string>>();
  farms.slice(0, farms.length - 2).forEach((farm, index) => {
    values.set(farm.tin, {
      summa: String(1_250_000 + index * 385_000),
      izoh: 'Noyabr 2026 xizmat haqi',
    });
  });
  return [{ dataset, values }];
}

function skipReason(farm: Farm): { code: string; message: string } | null {
  if (!farm.key.attached) return { code: 'EIMZO_KEY_MISSING', message: 'E-IMZO kaliti biriktirilmagan.' };
  if (farm.key.status === 'expired') return { code: 'EIMZO_KEY_EXPIRED', message: 'E-IMZO kaliti muddati tugagan.' };
  return null;
}

function makeRun(
  scenario: DemoScenario,
  farms: Farm[],
  mode: 'dry' | 'live',
  index: number,
): DemoRun {
  const selected = [...farms.slice(0, 4 + (index % 3))];
  if (index % 2 === 0) selected.push(farms[10]!);
  if (index % 3 === 0) selected.push(farms[5]!);
  const approvedAt = mode === 'live' ? new Date(Date.now() - (index + 1) * 3_600_000).toISOString() : null;
  const runFarms: RunFarm[] = selected.map((farm) => {
    const skip = skipReason(farm);
    return {
      id: uuid(),
      farmId: farm.id,
      name: farm.name,
      tin: farm.tin,
      status: skip ? 'skipped' : 'queued',
      startedAt: null,
      finishedAt: null,
      errorCode: skip?.code ?? null,
      errorMessage: skip?.message ?? null,
      screenshot: null,
      attempt: 0,
      keyValidTo: farm.key.validTo,
    };
  });
  const summary: RunSummary = {
    id: uuid(),
    scenarioId: scenario.scenario.id,
    scenarioName: scenario.scenario.name,
    scenarioVersion: scenario.scenario.version,
    mode,
    runner: 'simulated',
    status: 'completed',
    totalFarms: runFarms.length,
    doneCount: 0,
    errorCount: 0,
    skippedCount: 0,
    approvedAt,
    startedAt: null,
    finishedAt: null,
    message: null,
    createdAt: nowIso(),
    elapsedSeconds: 0,
    progress: 0,
    hasIrreversible: scenario.scenario.hasIrreversible,
    stepsCount: scenario.scenario.stepsCount,
    requiresApproval: mode === 'live' && scenario.scenario.hasIrreversible,
    datasetId: null,
  };
  return { run: summary, farms: runFarms, review: [], events: [], stepProgress: 0, timer: null };
}

function addEvent(run: DemoRun, type: string, message: string, farmId: string | null = null, data: unknown = null): RunEvent {
  const event: RunEvent = {
    id: eventSeq++,
    runId: run.run.id,
    runFarmId: farmId,
    ts: nowIso(),
    type,
    message,
    data,
  };
  run.events.push(event);
  return event;
}

function refreshCounts(run: DemoRun): void {
  run.run.doneCount = run.farms.filter((farm) => farm.status === 'done').length;
  run.run.errorCount = run.farms.filter((farm) => farm.status === 'error').length;
  run.run.skippedCount = run.farms.filter((farm) => farm.status === 'skipped').length;
  const processed = run.run.doneCount + run.run.errorCount + run.run.skippedCount;
  run.run.progress = run.run.totalFarms ? Math.round((processed / run.run.totalFarms) * 100) : 0;
  if (run.run.startedAt) {
    const end = run.run.finishedAt ? Date.parse(run.run.finishedAt) : Date.now();
    run.run.elapsedSeconds = Math.max(0, Math.floor((end - Date.parse(run.run.startedAt)) / 1_000));
  }
}

function finishRun(run: DemoRun, status: RunStatus): void {
  run.run.status = status;
  run.run.finishedAt = nowIso();
  refreshCounts(run);
  if (run.timer) {
    clearInterval(run.timer);
    run.timer = null;
  }
}

function tick(run: DemoRun): void {
  if (run.run.status !== 'running') return;
  let active = run.farms.find((farm) => farm.status === 'running');
  if (!active) {
    active = run.farms.find((farm) => farm.status === 'queued');
    if (!active) {
      addEvent(run, 'run_completed', 'Run yakunlandi.');
      finishRun(run, 'completed');
      addAudit('run.completed', 'run', run.run.id, {
        done: run.run.doneCount,
        errors: run.run.errorCount,
      });
      return;
    }
    active.status = 'running';
    active.startedAt = nowIso();
    active.attempt += 1;
    run.stepProgress = 0;
    addEvent(run, 'farm_started', `${active.name} boshlandi.`, active.id, { farm: active.name });
  }

  run.stepProgress += 1;
  addEvent(run, 'step', `${active.name}: qadam ${run.stepProgress}/${STEPS_PER_FARM}`, active.id, {
    step: String(run.stepProgress),
    type: run.stepProgress === STEPS_PER_FARM ? 'check' : 'click',
  });

  if (run.stepProgress >= STEPS_PER_FARM) {
    const farm = state.farms.find((item) => item.id === active!.farmId);
    const fails = /demo-xato|xato/i.test(farm?.note ?? '');
    active.status = fails ? 'error' : 'done';
    active.finishedAt = nowIso();
    if (fails) {
      active.errorCode = 'PAGE_UNEXPECTED';
      active.errorMessage = 'Kutilgan natija topilmadi (demo).';
    }
    const review: RunReview = {
      runFarmId: active.id,
      farmId: active.farmId,
      values: { summa: '1 250 000', sana: '18.11.2026' },
      missing: [],
    };
    run.review.push(review);
    addEvent(run, fails ? 'farm_error' : 'farm_done', `${active.name} ${fails ? 'xato bilan tugadi' : 'bajarildi'}.`, active.id);
    run.stepProgress = 0;
    refreshCounts(run);

    if (fails && state.settings.stopOnError) {
      run.run.status = 'paused';
      run.run.message = 'Xato sababli run to‘xtatildi — «xatoda to‘xtash» sozlamasi yoqilgan (BR-07).';
      addEvent(run, 'run_paused', run.run.message, null, { reason: 'stop_on_error' });
      if (run.timer) {
        clearInterval(run.timer);
        run.timer = null;
      }
      addAudit('run.paused_on_error', 'run', run.run.id, { reason: 'stop_on_error' });
      return;
    }
  }
  refreshCounts(run);
}

function startTimer(run: DemoRun): void {
  if (run.timer) return;
  run.timer = setInterval(() => tick(run), STEP_MS);
}

let auditSeq = 1;
function addAudit(action: string, entity: string, entityId: string, detail: Record<string, unknown>): void {
  state.audit.unshift({
    id: auditSeq++,
    ts: nowIso(),
    actor: 'buxgalter',
    action,
    entity,
    entityId,
    detail,
  });
}

function scenarioOf(run: DemoRun): DemoScenario | undefined {
  return state.scenarios.find((item) => item.scenario.id === run.run.scenarioId);
}

function viewOf(run: DemoRun): RunView {
  refreshCounts(run);
  return {
    run: { ...run.run },
    farms: run.farms.map((farm) => ({ ...farm })),
    review: run.review.map((item) => ({ ...item })),
  };
}

function buildState(): DemoState {
  const farms = makeFarms();
  const scenarios = makeScenarios();
  const datasets = makeDatasets(farms);

  const state: DemoState = {
    unlocked: true,
    settings: {
      runnerMode: 'simulated',
      manualMinutesPerFarm: 12,
      stopOnError: false,
      farmWaitSeconds: 3,
      accountabilityAcceptedAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      dataDir: 'Demo — brauzer xotirasi (simulyatsiya)',
      version: '0.1.0',
    },
    farms,
    scenarios,
    datasets,
    runs: [],
    audit: [],
    token: 'demo-robot-token',
  };

  // Demo tarix: oxirgi 7 kun bo‘yicha runlar (Toshkent vaqti).
  const today = dayKey();
  for (let offset = -6; offset <= 0; offset += 1) {
    const key = shiftDay(today, offset);
    const count = offset === 0 ? 2 : offset === -3 ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const scenario = scenarios[(offset + 7 + index) % scenarios.length]!;
      const mode: 'dry' | 'live' = index === 1 || (offset === -4 && index === 0) ? 'live' : 'dry';
      const run = makeRun(scenario, farms, mode, Math.abs(offset) + index);

      let cursor = dayStart(key).getTime() + (9 + ((offset + 6) % 5)) * 3_600_000 + index * 2 * 3_600_000 + 11 * 60_000;
      if (offset === 0) cursor = Date.now() - 3 * 3_600_000 + index * 40 * 60_000;
      const created = new Date(cursor - 60_000).toISOString();
      const withError = offset === -2 && index === 0;
      let errorAdded = false;

      run.run.createdAt = created;
      run.run.approvedAt = mode === 'live' ? created : null;
      run.run.startedAt = new Date(cursor).toISOString();
      addEvent(run, 'run_started', 'Run boshlandi.');

      for (const farm of run.farms) {
        if (farm.status === 'skipped') {
          addEvent(run, 'farm_skipped', `${farm.name} o‘tkazib yuborildi: ${farm.errorMessage ?? 'kalit yaroqsiz.'}`, farm.id);
          continue;
        }
        const duration = 3_000 + ((farm.tin.charCodeAt(8) % 4) + 1) * 900;
        farm.startedAt = new Date(cursor).toISOString();
        const fails = withError && !errorAdded;
        if (fails) errorAdded = true;
        farm.status = fails ? 'error' : 'done';
        farm.finishedAt = new Date(cursor + duration).toISOString();
        farm.attempt = 1;
        if (fails) {
          farm.errorCode = 'PAGE_UNEXPECTED';
          farm.errorMessage = 'Kutilgan natija topilmadi (demo).';
        }
        run.review.push({
          runFarmId: farm.id,
          farmId: farm.farmId,
          values: { summa: '1 250 000', sana: '18.11.2026' },
          missing: [],
        });
        addEvent(run, 'farm_started', `${farm.name} boshlandi.`, farm.id);
        addEvent(run, fails ? 'farm_error' : 'farm_done', `${farm.name} ${fails ? 'xato bilan tugadi' : 'bajarildi'}.`, farm.id);
        cursor = cursor + duration + 1_200;
      }

      run.run.finishedAt = new Date(cursor).toISOString();
      run.run.status = 'completed';
      refreshCounts(run);
      addEvent(run, 'run_completed', 'Run yakunlandi.');
      state.runs.push(run);
    }
  }
  state.runs.sort((a, b) => Date.parse(b.run.createdAt) - Date.parse(a.run.createdAt));
  auditSeq = 1;
  const audits: AuditEntry[] = [];
  const audit = (action: string, entity: string, entityId: string, detail: Record<string, unknown>) => {
    audits.unshift({ id: auditSeq++, ts: nowIso(), actor: 'buxgalter', action, entity, entityId, detail });
  };
  for (const run of state.runs.slice(0, 12)) {
    audit('run.created', 'run', run.run.id, { scenarioId: run.run.scenarioId, farms: run.run.totalFarms });
    audit('run.completed', 'run', run.run.id, {
      done: run.run.doneCount,
      errors: run.run.errorCount,
    });
  }
  audit('scenario.saved', 'scenario', scenarios[0]!.scenario.id, { name: scenarios[0]!.scenario.name, version: 1 });
  audit('settings.updated', 'settings', 'settings', { runnerMode: 'simulated' });
  state.audit = audits;
  return state;
}

let state: DemoState = buildState();

function metrics(): Metrics {
  const today = dayKey();
  const since30 = Date.now() - 30 * 86_400_000;
  const active = state.farms.filter((farm) => farm.status === 'active');
  const keyAlerts = active
    .filter((farm) => farm.key.daysLeft !== null && farm.key.daysLeft <= 30)
    .map((farm) => ({
      farmName: farm.name,
      tin: farm.tin,
      validTo: farm.key.validTo ?? '',
      daysLeft: farm.key.daysLeft ?? 0,
      status: (farm.key.daysLeft ?? 0) < 0 ? 'expired' : 'expiring',
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const windowRuns = state.runs.filter((run) => Date.parse(run.run.createdAt) >= since30);
  const allFarms = windowRuns.flatMap((run) => run.farms);
  const done = allFarms.filter((farm) => farm.status === 'done').length;
  const errors = allFarms.filter((farm) => farm.status === 'error').length;
  const skipped = allFarms.filter((farm) => farm.status === 'skipped').length;
  const attempts = done + errors;
  const startedRuns = state.runs.filter((run) => run.run.startedAt && Date.parse(run.run.createdAt) >= since30);
  const actualSeconds = startedRuns.reduce((sum, run) => {
    const start = Date.parse(run.run.startedAt ?? run.run.createdAt);
    const end = run.run.finishedAt ? Date.parse(run.run.finishedAt) : Date.now();
    return sum + Math.max(0, (end - start) / 1_000);
  }, 0);
  const finishedFarms = allFarms.filter((farm) => farm.status === 'done' && farm.startedAt && farm.finishedAt);
  const avgFarmSeconds = finishedFarms.length
    ? Math.round(
        (finishedFarms.reduce((sum, farm) => sum + (Date.parse(farm.finishedAt!) - Date.parse(farm.startedAt!)) / 1_000, 0) /
          finishedFarms.length) *
          10,
      ) / 10
    : null;

  const platforms = new Map<Platform, { platform: Platform; farms: number; runs: number }>();
  for (const farm of state.farms) {
    for (const credential of farm.credentials ?? []) {
      const item = platforms.get(credential.platform) ?? { platform: credential.platform, farms: 0, runs: 0 };
      item.farms += 1;
      platforms.set(credential.platform, item);
    }
  }
  for (const run of state.runs) {
    const scenario = scenarioOf(run);
    if (!scenario) continue;
    const item = platforms.get(scenario.scenario.platform) ?? { platform: scenario.scenario.platform, farms: 0, runs: 0 };
    item.runs += 1;
    platforms.set(scenario.scenario.platform, item);
  }

  const series = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const key = shiftDay(today, offset);
    const start = dayStart(key).getTime();
    const end = start + 86_400_000;
    let dayDone = 0;
    let dayError = 0;
    for (const run of state.runs) {
      for (const farm of run.farms) {
        if (!farm.finishedAt) continue;
        const ts = Date.parse(farm.finishedAt);
        if (ts < start || ts >= end) continue;
        if (farm.status === 'done') dayDone += 1;
        if (farm.status === 'error') dayError += 1;
      }
    }
    series.push({ date: key, done: dayDone, error: dayError });
  }

  const activeRun = state.runs.find((run) => ['running', 'paused', 'awaiting_approval'].includes(run.run.status));
  const manualMinutes = state.settings.manualMinutesPerFarm;

  return {
    farms: {
      total: state.farms.length,
      active: active.length,
      archived: state.farms.length - active.length,
      withKey: active.filter((farm) => farm.key.attached).length,
      missingKey: active.filter((farm) => !farm.key.attached).length,
    },
    keys: { expiring: keyAlerts.filter((alert) => alert.daysLeft >= 0).length, expired: keyAlerts.filter((alert) => alert.daysLeft < 0).length, alerts: keyAlerts.slice(0, 8) },
    runsToday: state.runs.filter((run) => dayKey(new Date(run.run.createdAt)) === today).length,
    runningRuns: state.runs.filter((run) => run.run.status === 'running').length,
    activeRun: activeRun
      ? {
          id: activeRun.run.id,
          scenarioName: activeRun.run.scenarioName,
          mode: activeRun.run.mode,
          runner: activeRun.run.runner,
          status: activeRun.run.status,
          totalFarms: activeRun.run.totalFarms,
          doneCount: activeRun.run.doneCount,
          errorCount: activeRun.run.errorCount,
          skippedCount: activeRun.run.skippedCount,
          progress: activeRun.run.progress,
          done: activeRun.run.doneCount,
          errors: activeRun.run.errorCount,
          total: activeRun.run.totalFarms,
          startedAt: activeRun.run.startedAt,
        }
      : null,
    last30: {
      done,
      errors,
      skipped,
      successRate: attempts ? Math.round((done / attempts) * 1000) / 10 : 0,
      unattendedRate: done + errors ? Math.round((done / (done + errors)) * 1000) / 10 : 0,
      avgFarmSeconds,
      manualInterventions: 0,
    },
    timeSaved: {
      manualMinutesPerFarm: manualMinutes,
      actualMinutes: Math.round(actualSeconds / 60),
      savedMinutes: Math.max(0, Math.round(done * manualMinutes - actualSeconds / 60)),
    },
    platforms: [...platforms.values()],
    recentRuns: state.runs.slice(0, 6).map((run) => ({ ...run.run })),
    series,
    totals: { runs: state.runs.length, farmsProcessed: done + errors, done, errors },
    runnerMode: state.settings.runnerMode,
  };
}

function coverage(dataset: DemoDataset): DatasetCoverage[] {
  return state.farms
    .filter((farm) => farm.status === 'active')
    .map((farm) => {
      const values = dataset.values.get(farm.tin) ?? {};
      return {
        tin: farm.tin,
        name: farm.name,
        missing: dataset.dataset.columns.filter((column) => !values[column]),
      };
    });
}

function scenarioView(item: DemoScenario): Scenario {
  return { ...item.scenario, stepsCount: countSteps(item.steps), hasIrreversible: hasIrreversible(item.steps) };
}

function detailOf(item: DemoScenario): ScenarioDetail {
  return {
    scenario: scenarioView(item),
    steps: item.steps,
    variables: item.variables,
    versions: item.versions,
  };
}

function farmDetail(farm: Farm): Farm {
  return { ...farm, credentials: farm.credentials ?? [] };
}

function findRun(id: string): DemoRun {
  const run = state.runs.find((item) => item.run.id === id);
  if (!run) throw new DemoError(404, 'NOT_FOUND', 'Run topilmadi.');
  return run;
}

function findScenario(id: string): DemoScenario {
  const item = state.scenarios.find((candidate) => candidate.scenario.id === id);
  if (!item) throw new DemoError(404, 'NOT_FOUND', 'Scenario topilmadi.');
  return item;
}

function findFarm(id: string): Farm {
  const farm = state.farms.find((candidate) => candidate.id === id);
  if (!farm) throw new DemoError(404, 'NOT_FOUND', 'Ferma topilmadi.');
  return farm;
}

function createRun(body: { scenarioId: string; farmIds: string[]; mode: 'dry' | 'live'; datasetId?: string | null }): RunView {
  const scenario = findScenario(body.scenarioId);
  const dataset = body.datasetId ? state.datasets.find((item) => item.dataset.id === body.datasetId) ?? null : null;
  const farms = body.farmIds.map(findFarm);
  if (farms.length === 0) throw new DemoError(400, 'NO_FARMS', 'Kamida bitta ferma tanlang.');

  const run: DemoRun = {
    run: {
      id: uuid(),
      scenarioId: scenario.scenario.id,
      scenarioName: scenario.scenario.name,
      scenarioVersion: scenario.scenario.version,
      mode: body.mode,
      runner: state.settings.runnerMode,
      status: 'running',
      totalFarms: farms.length,
      doneCount: 0,
      errorCount: 0,
      skippedCount: 0,
      approvedAt: body.mode === 'live' ? nowIso() : null,
      startedAt: nowIso(),
      finishedAt: null,
      message: null,
      createdAt: nowIso(),
      elapsedSeconds: 0,
      progress: 0,
      hasIrreversible: scenario.scenario.hasIrreversible,
      stepsCount: scenario.scenario.stepsCount,
      requiresApproval: body.mode === 'live' && scenario.scenario.hasIrreversible,
      datasetId: body.datasetId ?? null,
    },
    farms: farms.map((farm) => {
      const skip = skipReason(farm);
      return {
        id: uuid(),
        farmId: farm.id,
        name: farm.name,
        tin: farm.tin,
        status: skip ? 'skipped' : 'queued',
        startedAt: null,
        finishedAt: null,
        errorCode: skip?.code ?? null,
        errorMessage: skip?.message ?? null,
        screenshot: null,
        attempt: 0,
        keyValidTo: farm.key.validTo,
      };
    }),
    review: [],
    events: [],
    stepProgress: 0,
    timer: null,
  };

  if (state.settings.runnerMode !== 'simulated') {
    run.run.status = 'awaiting_approval';
  }
  if (run.run.requiresApproval) {
    run.run.status = 'awaiting_approval';
    run.run.approvedAt = null;
    run.run.startedAt = null;
  }
  refreshCounts(run);
  addEvent(run, 'run_created', 'Run yaratildi.');
  state.runs.unshift(run);
  addAudit('run.created', 'run', run.run.id, {
    scenarioId: scenario.scenario.id,
    farms: farms.length,
    mode: body.mode,
    datasetId: dataset?.dataset.id ?? null,
  });

  if (run.run.status === 'running') {
    run.run.startedAt = nowIso();
    addEvent(run, 'run_started', 'Run boshlandi.');
    startTimer(run);
  } else {
    addEvent(run, 'run_awaiting_approval', 'Imzolash uchun buxgalter tasdig‘i kutilmoqda.');
  }
  return viewOf(run);
}

function approveRun(run: DemoRun): void {
  if (run.run.status !== 'awaiting_approval') return;
  run.run.status = 'running';
  run.run.approvedAt = nowIso();
  run.run.startedAt = nowIso();
  addEvent(run, 'run_approved', 'Buxgalter tasdiqladi — run boshlandi.');
  addEvent(run, 'run_started', 'Run boshlandi.');
  addAudit('run.approved', 'run', run.run.id, {});
  startTimer(run);
}

export async function demoRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  await delay(90 + Math.random() * 120);
  const method = (init.method ?? 'GET').toUpperCase();
  const [pathname = '', search = ''] = path.split('?');
  const query = new URLSearchParams(search);
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  const parts = pathname.replace(/^\//, '').split('/');

  if (pathname === '/auth/status') return { setup: true, unlocked: state.unlocked };
  if (pathname === '/auth/login' && method === 'POST') {
    state.unlocked = true;
    addAudit('auth.login', 'settings', 'session', {});
    return { ok: true, robotToken: state.token };
  }
  if (pathname === '/auth/setup' && method === 'POST') {
    state.unlocked = true;
    return { ok: true, robotToken: state.token };
  }
  if (pathname === '/auth/lock' && method === 'POST') {
    state.unlocked = false;
    return { ok: true };
  }
  if (pathname === '/auth/robot-token') return { token: state.token, expiresInDays: 180 };

  if (!state.unlocked) throw new DemoError(401, 'LOCKED', 'Sessiya qulflangan.');

  if (pathname === '/settings' && method === 'GET') return state.settings;
  if (pathname === '/settings' && method === 'PATCH') {
    const patch = body ?? {};
    state.settings = {
      ...state.settings,
      runnerMode: patch.runnerMode === 'desktop' ? 'desktop' : patch.runnerMode === 'simulated' ? 'simulated' : state.settings.runnerMode,
      manualMinutesPerFarm: typeof patch.manualMinutesPerFarm === 'number' ? patch.manualMinutesPerFarm : state.settings.manualMinutesPerFarm,
      stopOnError: typeof patch.stopOnError === 'boolean' ? patch.stopOnError : state.settings.stopOnError,
      farmWaitSeconds: typeof patch.farmWaitSeconds === 'number' ? patch.farmWaitSeconds : state.settings.farmWaitSeconds,
    };
    addAudit('settings.updated', 'settings', 'settings', patch);
    return state.settings;
  }

  if (pathname === '/metrics') return metrics();

  if (pathname === '/farms' && method === 'GET') {
    const searchText = (query.get('search') ?? '').toLowerCase();
    const status = query.get('status') ?? 'active';
    const group = query.get('group') ?? '';
    const farms = state.farms
      .filter((farm) => (status === 'all' ? true : farm.status === status))
      .filter((farm) => (group ? farm.groupName === group : true))
      .filter((farm) => (searchText ? farm.name.toLowerCase().includes(searchText) || farm.tin.includes(searchText) : true))
      .map(farmDetail);
    const groups = [...new Set(state.farms.map((farm) => farm.groupName).filter(Boolean) as string[])].sort();
    return { farms, groups };
  }
  if (pathname === '/farms' && method === 'POST') {
    const name = String(body?.name ?? '').trim();
    const tin = String(body?.tin ?? '').trim();
    if (name.length < 2 || tin.length < 5) throw new DemoError(400, 'VALIDATION', 'Nom va STIR to‘ldirilishi kerak.');
    if (state.farms.some((farm) => farm.tin === tin)) throw new DemoError(409, 'TIN_EXISTS', 'Bu STIR allaqachon mavjud.');
    const farm: Farm = {
      id: uuid(),
      name,
      tin,
      groupName: body?.groupName ? String(body.groupName) : null,
      note: body?.note ? String(body.note) : null,
      status: 'active',
      oneCUrl: null,
      consentAt: nowIso(),
      key: makeKey(tin, name, null),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      credentials: [],
    };
    state.farms.push(farm);
    addAudit('farm.created', 'farm', farm.id, { name, tin });
    return { farm: farmDetail(farm) };
  }
  if (pathname === '/farms/import' && method === 'POST') {
    addAudit('farm.imported', 'farm', 'import', {});
    return { created: 0, updated: 0, errors: [], headers: ['Nomi', 'STIR', 'Guruh'] };
  }

  if (parts[0] === 'farms' && parts.length >= 2) {
    const farm = findFarm(parts[1]!);
    if (parts.length === 2 && method === 'GET') return { farm: farmDetail(farm) };
    if (parts.length === 2 && method === 'PATCH') {
      const patch = body ?? {};
      if (patch.name) farm.name = String(patch.name);
      if (patch.groupName !== undefined) farm.groupName = patch.groupName ? String(patch.groupName) : null;
      if (patch.note !== undefined) farm.note = patch.note ? String(patch.note) : null;
      if (patch.oneCUrl !== undefined) farm.oneCUrl = patch.oneCUrl ? String(patch.oneCUrl) : null;
      farm.updatedAt = nowIso();
      addAudit('farm.updated', 'farm', farm.id, { name: farm.name });
      return { farm: farmDetail(farm) };
    }
    if (parts[2] === 'key' && method === 'POST') {
      const days = 365;
      farm.key = makeKey(farm.tin, farm.name, days);
      farm.updatedAt = nowIso();
      addAudit('farm.key_attached', 'farm', farm.id, { subject: farm.key.subject });
      return { key: { subject: `${farm.name} rahbari`, tin: farm.tin, notAfter: farm.key.validTo, tinMismatch: false } };
    }
    if (parts[2] === 'key' && method === 'DELETE') {
      farm.key = makeKey(farm.tin, farm.name, null);
      farm.updatedAt = nowIso();
      addAudit('farm.key_removed', 'farm', farm.id, {});
      return { ok: true };
    }
    if (parts[2] === 'credentials' && method === 'PUT') {
      const platform = String(body?.platform ?? 'didox') as Platform;
      const list = farm.credentials ?? [];
      const existing = list.find((item) => item.platform === platform);
      const credential: Credential = {
        platform,
        login: body?.login ? String(body.login) : existing?.login ?? null,
        hasPassword: Boolean(body?.password) || Boolean(existing?.hasPassword),
        hasEriPassword: Boolean(body?.eriPassword) || Boolean(existing?.hasEriPassword),
        updatedAt: nowIso(),
      };
      farm.credentials = [...list.filter((item) => item.platform !== platform), credential];
      if (body?.oneCUrl) farm.oneCUrl = String(body.oneCUrl);
      farm.updatedAt = nowIso();
      addAudit('farm.credentials_saved', 'farm', farm.id, { platform });
      return { ok: true };
    }
    if (parts[2] === 'archive' && method === 'POST') {
      farm.status = 'archived';
      farm.updatedAt = nowIso();
      addAudit('farm.archived', 'farm', farm.id, {});
      return { farm: farmDetail(farm) };
    }
    if (parts[2] === 'restore' && method === 'POST') {
      farm.status = 'active';
      farm.updatedAt = nowIso();
      addAudit('farm.restored', 'farm', farm.id, {});
      return { farm: farmDetail(farm) };
    }
    if (parts[2] === 'consent' && method === 'POST') {
      farm.consentAt = nowIso();
      farm.updatedAt = nowIso();
      addAudit('farm.consent', 'farm', farm.id, {});
      return { farm: farmDetail(farm) };
    }
  }

  if (pathname === '/scenarios' && method === 'GET') {
    const searchText = (query.get('search') ?? '').toLowerCase();
    const platform = query.get('platform') ?? '';
    const scenarios = state.scenarios
      .filter((item) => (searchText ? item.scenario.name.toLowerCase().includes(searchText) : true))
      .filter((item) => (platform ? item.scenario.platform === platform : true))
      .map((item) => scenarioView(item));
    return { scenarios };
  }
  if (pathname === '/scenarios' && method === 'POST') {
    const name = String(body?.name ?? '').trim();
    if (name.length < 2) throw new DemoError(400, 'VALIDATION', 'Scenario nomi kiritilishi kerak.');
    const created = nowIso();
    const item: DemoScenario = {
      scenario: {
        id: uuid(),
        name,
        platform: (body?.platform as Platform) ?? 'didox',
        folder: body?.folder ? String(body.folder) : null,
        description: body?.description ? String(body.description) : null,
        status: 'active',
        version: 0,
        stepsCount: 0,
        hasIrreversible: false,
        createdAt: created,
        updatedAt: created,
      },
      steps: [],
      variables: [],
      versions: [],
    };
    state.scenarios.push(item);
    addAudit('scenario.created', 'scenario', item.scenario.id, { name });
    return { scenario: scenarioView(item) };
  }

  if (parts[0] === 'scenarios' && parts.length >= 2) {
    const item = findScenario(parts[1]!);
    if (parts.length === 2 && method === 'GET') return detailOf(item);
    if (parts.length === 2 && method === 'PATCH') {
      const patch = body ?? {};
      if (patch.name) item.scenario.name = String(patch.name);
      if (patch.folder !== undefined) item.scenario.folder = patch.folder ? String(patch.folder) : null;
      if (patch.description !== undefined) item.scenario.description = patch.description ? String(patch.description) : null;
      item.scenario.updatedAt = nowIso();
      addAudit('scenario.updated', 'scenario', item.scenario.id, { name: item.scenario.name });
      return { scenario: scenarioView(item) };
    }
    if (parts.length === 2 && method === 'DELETE') {
      if (state.runs.some((run) => run.run.scenarioId === item.scenario.id)) {
        throw new DemoError(409, 'SCENARIO_IN_USE', 'Bu scenarioda run tarixi bor — uni arxivlang (tarix saqlanadi).');
      }
      state.scenarios = state.scenarios.filter((candidate) => candidate !== item);
      addAudit('scenario.deleted', 'scenario', item.scenario.id, { name: item.scenario.name });
      return { ok: true };
    }
    if (parts.length === 2 && method === 'PUT') {
      const steps = (body?.steps as Step[]) ?? item.steps;
      const variables = (body?.variables as Variable[]) ?? item.variables;
      item.steps = steps;
      item.variables = variables;
      item.scenario.version += 1;
      item.scenario.updatedAt = nowIso();
      item.scenario.stepsCount = countSteps(steps);
      item.scenario.hasIrreversible = hasIrreversible(steps);
      item.versions.push({ version: item.scenario.version, note: body?.note ? String(body.note) : null, createdAt: nowIso() });
      addAudit('scenario.saved', 'scenario', item.scenario.id, { version: item.scenario.version });
      return { scenario: scenarioView(item) };
    }
    if (parts[2] === 'rollback' && method === 'POST') {
      item.scenario.version += 1;
      item.scenario.updatedAt = nowIso();
      item.versions.push({ version: item.scenario.version, note: `v${String(body?.version)} ga qaytarildi`, createdAt: nowIso() });
      addAudit('scenario.rolled_back', 'scenario', item.scenario.id, { version: body?.version });
      return { scenario: scenarioView(item) };
    }
    if (parts[2] === 'copy' && method === 'POST') {
      const copy: DemoScenario = {
        scenario: {
          ...item.scenario,
          id: uuid(),
          name: `${item.scenario.name} (nusxa)`,
          version: item.scenario.version,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
        steps: item.steps.map((existing) => ({ ...existing, id: uuid() })),
        variables: item.variables.map((variable) => ({ ...variable })),
        versions: item.versions.map((version) => ({ ...version })),
      };
      state.scenarios.push(copy);
      addAudit('scenario.copied', 'scenario', copy.scenario.id, { from: item.scenario.id });
      return { scenario: scenarioView(copy) };
    }
    if (parts[2] === 'archive' && method === 'POST') {
      item.scenario.status = 'archived';
      item.scenario.updatedAt = nowIso();
      addAudit('scenario.archived', 'scenario', item.scenario.id, {});
      return { scenario: scenarioView(item) };
    }
    if (parts[2] === 'restore' && method === 'POST') {
      item.scenario.status = 'active';
      item.scenario.updatedAt = nowIso();
      addAudit('scenario.restored', 'scenario', item.scenario.id, {});
      return { scenario: scenarioView(item) };
    }
  }

  if (pathname === '/datasets' && method === 'GET') return { datasets: state.datasets.map((item) => item.dataset) };
  if (pathname === '/datasets' && method === 'POST') {
    const dataset: Dataset = {
      id: uuid(),
      name: `Import ${state.datasets.length + 1}`,
      sourceName: 'demo.xlsx',
      columns: ['summa', 'izoh'],
      rowsCount: state.farms.length - 2,
      createdAt: nowIso(),
    };
    state.datasets.push({ dataset, values: new Map() });
    addAudit('dataset.imported', 'dataset', dataset.id, { name: dataset.name });
    return { dataset, unknownTins: [], preview: [{ summa: '1250000', izoh: 'Noyabr 2026' }] };
  }
  if (parts[0] === 'datasets' && parts.length === 2) {
    const item = state.datasets.find((candidate) => candidate.dataset.id === parts[1]);
    if (!item) throw new DemoError(404, 'NOT_FOUND', 'To‘plam topilmadi.');
    if (method === 'GET') return { dataset: item.dataset, coverage: coverage(item) };
    if (method === 'DELETE') {
      state.datasets = state.datasets.filter((candidate) => candidate !== item);
      addAudit('dataset.deleted', 'dataset', item.dataset.id, {});
      return { ok: true };
    }
  }

  if (pathname === '/runs' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 30)));
    return { runs: state.runs.slice(0, limit).map((run) => ({ ...run.run })) };
  }
  if (pathname === '/runs' && method === 'POST') {
    return createRun({
      scenarioId: String(body?.scenarioId ?? ''),
      farmIds: (body?.farmIds as string[]) ?? [],
      mode: body?.mode === 'live' ? 'live' : 'dry',
      datasetId: body?.datasetId ? String(body.datasetId) : null,
    });
  }
  if (parts[0] === 'runs' && parts.length === 2 && parts[1] !== 'stream') {
    const run = findRun(parts[1]!);
    if (method === 'GET') return viewOf(run);
  }
  if (parts[0] === 'runs' && parts[2] === 'events' && method === 'GET') {
    const run = findRun(parts[1]!);
    const after = Number(query.get('after') ?? 0);
    return { events: run.events.filter((event) => event.id > after).slice(0, 200) };
  }
  if (parts[0] === 'runs' && parts[2] && method === 'POST') {
    const run = findRun(parts[1]!);
    const action = parts[2];
    if (action === 'approve') approveRun(run);
    else if (action === 'pause') {
      if (run.run.status === 'running') {
        run.run.status = 'paused';
        addEvent(run, 'run_paused', 'Run pauza qilindi.');
      }
    } else if (action === 'resume') {
      if (run.run.status === 'paused') {
        run.run.status = 'running';
        if (!run.run.startedAt) run.run.startedAt = nowIso();
        if (run.timer) {
          clearInterval(run.timer);
          run.timer = null;
        }
        addEvent(run, 'run_resumed', 'Run davom ettirildi.');
        startTimer(run);
      } else if (run.run.status === 'awaiting_approval') {
        approveRun(run);
      }
    } else if (action === 'cancel') {
      if (['running', 'paused', 'awaiting_approval'].includes(run.run.status)) {
        addEvent(run, 'run_cancelled', 'Run bekor qilindi.');
        finishRun(run, 'cancelled');
        if (run.run.startedAt && !run.run.finishedAt) run.run.finishedAt = nowIso();
        addAudit('run.cancelled', 'run', run.run.id, {});
      }
    } else if (action === 'retry-failed') {
      for (const farm of run.farms) {
        if (farm.status === 'error') {
          farm.status = 'queued';
          farm.errorCode = null;
          farm.errorMessage = null;
        }
      }
      run.run.finishedAt = null;
      run.run.status = 'running';
      if (!run.run.startedAt) run.run.startedAt = nowIso();
      refreshCounts(run);
      addEvent(run, 'run_retry', 'Xato fermalar qayta navbatga qo‘yildi.');
      startTimer(run);
    }
    return viewOf(run);
  }

  if (pathname === '/reports/runs' && method === 'GET') {
    const from = Date.parse(query.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString());
    const to = Date.parse(query.get('to') ?? new Date().toISOString());
    const runs = state.runs.filter((run) => {
      const ts = Date.parse(run.run.createdAt);
      return ts >= from && ts <= to;
    });
    const totals = runs.reduce(
      (acc, run) => {
        acc.runs += 1;
        acc.farms += run.run.totalFarms;
        acc.done += run.run.doneCount;
        acc.errors += run.run.errorCount;
        acc.skipped += run.run.skippedCount;
        return acc;
      },
      { runs: 0, farms: 0, done: 0, errors: 0, skipped: 0 },
    );
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      totals,
      runs: runs.map((run) => ({
        id: run.run.id,
        scenarioName: run.run.scenarioName,
        scenarioVersion: run.run.scenarioVersion,
        mode: run.run.mode,
        runner: run.run.runner,
        status: run.run.status,
        totalFarms: run.run.totalFarms,
        doneCount: run.run.doneCount,
        errorCount: run.run.errorCount,
        skippedCount: run.run.skippedCount,
        createdAt: run.run.createdAt,
        startedAt: run.run.startedAt,
        finishedAt: run.run.finishedAt,
      })),
    };
  }

  if (pathname === '/audit' && method === 'GET') {
    const searchText = (query.get('search') ?? '').toLowerCase();
    const limit = Number(query.get('limit') ?? 100);
    const entries = state.audit
      .filter((entry) =>
        searchText
          ? `${entry.action} ${entry.entity ?? ''} ${entry.entityId ?? ''} ${JSON.stringify(entry.detail ?? '')}`
              .toLowerCase()
              .includes(searchText)
          : true,
      )
      .slice(0, limit);
    return { entries };
  }

  throw new DemoError(404, 'NOT_FOUND', `Demo rejimda bu amal mavjud emas: ${method} ${pathname}`);
}

export function demoDownload(path: string): { blob: Blob; filename: string } {
  const match = /^\/reports\/runs\/([^/]+)\/export\.xlsx$/.exec(path);
  if (!match) {
    return { blob: new Blob(['Demo rejim — fayl mavjud emas.'], { type: 'text/plain' }), filename: 'demo.txt' };
  }
  const run = state.runs.find((item) => item.run.id === match[1]);
  if (!run) throw new DemoError(404, 'NOT_FOUND', 'Run topilmadi.');
  const lines = [
    'Buxgalter RPA — demo hisobot (Toshkent vaqti)',
    `Run,${run.run.id}`,
    `Scenario,${run.run.scenarioName} v${run.run.scenarioVersion}`,
    `Rejim,${run.run.mode === 'dry' ? 'Dry run' : 'Live'}`,
    `Holat,${run.run.status}`,
    `Fermalar,${run.run.totalFarms}`,
    `Bajarildi,${run.run.doneCount}`,
    `Xato,${run.run.errorCount}`,
    `O‘tkazildi,${run.run.skippedCount}`,
    `Boshlandi,${run.run.startedAt ?? ''}`,
    `Tugadi,${run.run.finishedAt ?? ''}`,
    '',
    '№,Ferma,STIR,Holat,Boshlandi,Tugadi',
    ...run.farms.map((farm, index) =>
      [index + 1, farm.name, farm.tin, farm.status, farm.startedAt ?? '', farm.finishedAt ?? ''].join(','),
    ),
  ];
  return {
    blob: new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }),
    filename: `run-${run.run.id.slice(0, 8)}.csv`,
  };
}
