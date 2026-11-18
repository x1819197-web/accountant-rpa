import { Router } from 'express';
import { all } from '../db.js';

export const auditRouter = Router();

auditRouter.get('/', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60)));
  const search = String(req.query.search ?? '').trim();
  const rows = all<{
    id: number;
    ts: string;
    actor: string;
    action: string;
    entity: string | null;
    entity_id: string | null;
    detail: string | null;
  }>(
    `SELECT * FROM audit_log WHERE (? = '' OR action LIKE ? OR entity LIKE ? OR detail LIKE ?)
     ORDER BY id DESC LIMIT ?`,
    search,
    `%${search}%`,
    `%${search}%`,
    `%${search}%`,
    limit,
  );
  res.json({
    entries: rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      actor: row.actor,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      detail: row.detail ? JSON.parse(row.detail) : null,
    })),
  });
});
