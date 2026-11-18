import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { errorHandler } from './lib/http.js';
import { requireAuth } from './lib/security.js';
import { authRouter } from './routes/auth.js';
import { robotRouter } from './routes/robot.js';
import { farmsRouter } from './routes/farms.js';
import { scenariosRouter } from './routes/scenarios.js';
import { datasetsRouter } from './routes/datasets.js';
import { runsRouter } from './routes/runs.js';
import { metricsRouter } from './routes/metrics.js';
import { reportsRouter } from './routes/reports.js';
import { auditRouter } from './routes/audit.js';
import { settingsRouter } from './routes/settings.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, at: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/robot', robotRouter);
  app.use('/demo', express.static(path.join(env.publicDir, 'demo')));

  app.use('/api', requireAuth);
  app.use('/api/farms', farmsRouter);
  app.use('/api/scenarios', scenariosRouter);
  app.use('/api/datasets', datasetsRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/metrics', metricsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/settings', settingsRouter);

  if (fs.existsSync(path.join(env.webDist, 'index.html'))) {
    app.use(express.static(env.webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(env.webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
