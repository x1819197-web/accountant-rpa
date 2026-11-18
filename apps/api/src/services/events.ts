import type { Response } from 'express';
import { db, get } from '../db.js';

const clients = new Map<string, Set<Response>>();

export function subscribe(runId: string, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const set = clients.get(runId) ?? new Set<Response>();
  set.add(res);
  clients.set(runId, set);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(heartbeat);
    set.delete(res);
    if (set.size === 0) clients.delete(runId);
  });
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

export function emit(
  runId: string,
  type: string,
  message: string | null | undefined,
  data?: unknown,
  runFarmId?: string | null,
): RunEvent {
  const ts = new Date().toISOString();
  const result = db
    .prepare('INSERT INTO run_events (run_id, run_farm_id, ts, type, message, data_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, runFarmId ?? null, ts, type, message ?? null, data === undefined ? null : JSON.stringify(data));
  const event: RunEvent = {
    id: Number(result.lastInsertRowid),
    runId,
    runFarmId: runFarmId ?? null,
    ts,
    type,
    message: message ?? null,
    data: data ?? null,
  };

  const payload = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.get(runId) ?? []) client.write(payload);
  return event;
}

export function listEvents(runId: string, after = 0, limit = 200): RunEvent[] {
  const rows = getRunEvents(runId, after, limit);
  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    runFarmId: row.run_farm_id,
    ts: row.ts,
    type: row.type,
    message: row.message,
    data: row.data_json ? JSON.parse(row.data_json) : null,
  }));
}

function getRunEvents(runId: string, after: number, limit: number) {
  return db
    .prepare('SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?')
    .all(runId, after, limit) as Array<{
    id: number;
    run_id: string;
    run_farm_id: string | null;
    ts: string;
    type: string;
    message: string | null;
    data_json: string | null;
  }>;
}

export function runExists(runId: string): boolean {
  return Boolean(get('SELECT id FROM runs WHERE id = ?', runId));
}
