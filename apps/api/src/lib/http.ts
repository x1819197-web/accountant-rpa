import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { run, now } from '../db.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      code: 'VALIDATION',
      message: 'Kiritilgan ma’lumot noto‘g‘ri.',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  console.error(err);
  res.status(500).json({ code: 'INTERNAL', message: 'Ichki xato yuz berdi.' });
}

export function audit(actor: string, action: string, entity?: string, entityId?: string, detail?: unknown): void {
  run(
    'INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    now(),
    actor,
    action,
    entity ?? null,
    entityId ?? null,
    detail === undefined ? null : JSON.stringify(detail),
  );
}
