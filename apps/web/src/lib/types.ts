export type Platform = 'didox' | '1c' | 'my3' | 'eijara' | 'other';

export interface KeyInfo {
  attached: boolean;
  subject: string | null;
  tin: string | null;
  validTo: string | null;
  attachedAt: string | null;
  status: 'missing' | 'expired' | 'expiring' | 'ok';
  daysLeft: number | null;
  tinMismatch: boolean;
}

export interface Credential {
  platform: Platform;
  login: string | null;
  hasPassword: boolean;
  hasEriPassword: boolean;
  updatedAt: string;
}

export interface Farm {
  id: string;
  name: string;
  tin: string;
  groupName: string | null;
  note: string | null;
  status: 'active' | 'archived';
  oneCUrl: string | null;
  consentAt: string | null;
  key: KeyInfo;
  createdAt: string;
  updatedAt: string;
  credentials?: Credential[];
}

export interface StepBase {
  id: string;
  description: string;
  enabled?: boolean;
}

export type Step =
  | (StepBase & { type: 'navigate'; url: string })
  | (StepBase & { type: 'click'; selector: string; expectedText?: string; irreversible?: boolean })
  | (StepBase & { type: 'sign'; selector: string })
  | (StepBase & { type: 'fill'; selector: string; value: string; variable?: string; secret?: 'login' | 'password' | 'eri' })
  | (StepBase & {
      type: 'extract';
      selector: string;
      variable: string;
      attribute?: 'text' | 'value' | 'href';
    })
  | (StepBase & { type: 'wait'; ms?: number; selector?: string })
  | (StepBase & { type: 'check'; selector?: string; text?: string })
  | (StepBase & { type: 'eimzo-login'; platform: string })
  | (StepBase & { type: 'password-login'; platform: string })
  | (StepBase & { type: 'manual'; reason?: string })
  | (StepBase & { type: 'loop'; selector: string; steps: Step[] })
  | (StepBase & { type: 'condition'; selector: string; then: Step[]; otherwise: Step[] });

export interface Variable {
  name: string;
  label: string;
  source: 'system' | 'dataset' | 'constant';
  systemKey?: 'farm.name' | 'farm.tin' | 'date' | 'period';
  value?: string;
}

export interface Scenario {
  id: string;
  name: string;
  platform: Platform;
  folder: string | null;
  description: string | null;
  status: 'active' | 'archived';
  version: number;
  stepsCount: number;
  hasIrreversible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioDetail {
  scenario: Scenario;
  steps: Step[];
  variables: Variable[];
  versions: Array<{ version: number; note: string | null; createdAt: string }>;
}

export interface Dataset {
  id: string;
  name: string;
  sourceName: string | null;
  columns: string[];
  rowsCount: number;
  createdAt: string;
}

export interface DatasetCoverage {
  tin: string;
  name: string;
  missing: string[];
}

export interface RunSummary {
  id: string;
  scenarioId: string;
  scenarioName: string;
  scenarioVersion: number;
  mode: 'dry' | 'live';
  runner: 'simulated' | 'desktop';
  status: RunStatus;
  totalFarms: number;
  doneCount: number;
  errorCount: number;
  skippedCount: number;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
  createdAt: string;
  elapsedSeconds: number;
  progress: number;
  hasIrreversible: boolean;
  stepsCount: number;
  requiresApproval: boolean;
  datasetId?: string | null;
}

export type RunStatus = 'awaiting_approval' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed';
export type FarmRunStatus = 'queued' | 'running' | 'done' | 'error' | 'skipped';

export interface RunFarm {
  id: string;
  farmId: string;
  name: string;
  tin: string;
  status: FarmRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  screenshot: string | null;
  attempt: number;
  keyValidTo: string | null;
}

export interface RunReview {
  runFarmId: string;
  farmId: string;
  values: Record<string, string>;
  missing: string[];
}

export interface RunView {
  run: RunSummary;
  farms: RunFarm[];
  review: RunReview[];
}

export interface RunEvent {
  id: number;
  runId: string;
  runFarmId: string | null;
  ts: string;
  type: string;
  message: string | null;
  data: unknown;
}

export interface Metrics {
  farms: { total: number; active: number; archived: number; withKey: number; missingKey: number };
  keys: {
    expiring: number;
    expired: number;
    alerts: Array<{ farmName: string; tin: string; validTo: string; daysLeft: number; status: string }>;
  };
  runsToday: number;
  runningRuns: number;
  activeRun: {
    id: string;
    scenarioName: string;
    mode: 'dry' | 'live';
    runner: 'simulated' | 'desktop';
    status: RunStatus;
    totalFarms: number;
    doneCount: number;
    errorCount: number;
    skippedCount: number;
    progress: number;
    done: number;
    errors: number;
    total: number;
    startedAt: string | null;
  } | null;
  last30: {
    done: number;
    errors: number;
    skipped: number;
    successRate: number;
    unattendedRate: number;
    avgFarmSeconds: number | null;
    manualInterventions: number;
  };
  timeSaved: { manualMinutesPerFarm: number; actualMinutes: number; savedMinutes: number };
  platforms: Array<{ platform: Platform; farms: number; runs: number }>;
  recentRuns: RunSummary[];
  series: Array<{ date: string; done: number; error: number }>;
  totals: { runs: number; farmsProcessed: number; done: number; errors: number };
  runnerMode: 'simulated' | 'desktop';
}

export interface Settings {
  runnerMode: 'simulated' | 'desktop';
  manualMinutesPerFarm: number;
  stopOnError: boolean;
  farmWaitSeconds: number;
  accountabilityAcceptedAt: string | null;
  dataDir: string;
  version: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  detail: unknown;
}
