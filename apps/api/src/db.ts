import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { env } from './env.js';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tin TEXT NOT NULL UNIQUE,
  group_name TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  key_subject TEXT,
  key_tin TEXT,
  key_valid_to TEXT,
  key_attached_at TEXT,
  key_file_enc TEXT,
  consent_at TEXT,
  one_c_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  login TEXT,
  secret_enc TEXT,
  eri_password_enc TEXT,
  extra_enc TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, platform)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  folder TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scenario_versions (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  steps_json TEXT NOT NULL,
  variables_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (scenario_id, version)
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_name TEXT,
  columns_json TEXT NOT NULL,
  rows_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_values (
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  farm_tin TEXT NOT NULL,
  variable TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (dataset_id, farm_tin, variable)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  scenario_version INTEGER NOT NULL,
  dataset_id TEXT REFERENCES datasets(id),
  mode TEXT NOT NULL CHECK (mode IN ('dry','live')),
  runner TEXT NOT NULL CHECK (runner IN ('simulated','desktop')),
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval','running','paused','cancelled','completed','failed')),
  total_farms INTEGER NOT NULL,
  done_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_farms (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  farm_id TEXT NOT NULL REFERENCES farms(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','error','skipped')),
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT,
  screenshot TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, farm_id)
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  run_farm_id TEXT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT,
  data_json TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_farms_run ON run_farms(run_id, status);
CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`;

export const db = new DatabaseSync(path.join(env.dataDir, 'app.db'));
db.exec(SCHEMA);

export function all<T>(sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Array<string | number | null>): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Array<string | number | null>): void {
  db.prepare(sql).run(...params);
}

export function now(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | undefined {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}

export function setSetting(key: string, value: string): void {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}
