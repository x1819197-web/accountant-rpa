import fs from 'node:fs';
import path from 'node:path';
import type { Step, Variable } from './types';

export interface DesktopConfig {
  apiUrl: string;
  robotToken: string;
}

export interface JobFarm {
  id: string;
  name: string;
  tin: string;
  oneCUrl: string | null;
  keySubject: string | null;
  keyValidTo: string | null;
}

export interface DesktopJob {
  id: string;
  runId: string;
  mode: 'dry' | 'live';
  scenario: { id: string; name: string; platform: string; steps: Step[]; variables: Variable[] };
  farm: JobFarm;
  values: Record<string, string>;
  secrets: { login: string | null; password: string | null; eriPassword: string | null; oneCUrl: string | null };
  serverTime: string;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  platform: string;
  folder: string | null;
  version: number;
  stepsCount: number;
  hasIrreversible: boolean;
  updatedAt: string;
}

export class RobotClient {
  constructor(public apiUrl: string, public token: string) {}

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiUrl.replace(/\/+$/, '')}${endpoint}`, {
      method,
      headers: {
        'x-robot-token': this.token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error((data as { message?: string }).message ?? `HTTP ${response.status}`) as Error & {
        status?: number;
        code?: string;
      };
      error.status = response.status;
      error.code = (data as { code?: string }).code;
      throw error;
    }
    return data as T;
  }

  health(): Promise<{ ok: boolean }> {
    return this.request('GET', '/api/health');
  }

  nextJob(): Promise<{ job: DesktopJob | null; state: 'idle' | 'busy' | 'job' | 'waiting'; retryInMs?: number }> {
    return this.request('GET', '/api/robot/jobs/next');
  }

  runState(runId: string): Promise<{ status: string; mode: string }> {
    return this.request('GET', `/api/robot/runs/${runId}/state`);
  }

  event(jobId: string, type: string, message?: string, data?: unknown): Promise<{ ok: true }> {
    return this.request('POST', `/api/robot/jobs/${jobId}/event`, { type, message, data });
  }

  complete(
    jobId: string,
    body: { ok: boolean; errorCode?: string; errorMessage?: string; screenshotBase64?: string },
  ): Promise<{ ok: true }> {
    return this.request('POST', `/api/robot/jobs/${jobId}/complete`, body);
  }

  scenarios(): Promise<{ scenarios: ScenarioSummary[] }> {
    return this.request('GET', '/api/robot/scenarios');
  }

  scenario(id: string): Promise<{ scenario: ScenarioSummary; steps: Step[]; variables: Variable[] }> {
    return this.request('GET', `/api/robot/scenarios/${id}`);
  }

  createScenario(body: {
    name: string;
    platform: string;
    folder?: string;
    description?: string;
    steps: Step[];
    variables: Variable[];
    note?: string;
  }): Promise<{ scenario: { id: string; name: string; version: number } }> {
    return this.request('POST', '/api/robot/scenarios', body);
  }

  saveScenario(
    id: string,
    body: { steps: Step[]; variables: Variable[]; note?: string },
  ): Promise<{ scenario: { id: string; name: string; version: number } }> {
    return this.request('PUT', `/api/robot/scenarios/${id}`, body);
  }
}

export function loadConfig(file: string): DesktopConfig {
  const defaults: DesktopConfig = {
    apiUrl: process.env.RPA_API_URL ?? 'http://localhost:3100',
    robotToken: process.env.RPA_ROBOT_TOKEN ?? '',
  };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DesktopConfig>;
    return {
      apiUrl: raw.apiUrl || defaults.apiUrl,
      robotToken: raw.robotToken || defaults.robotToken,
    };
  } catch {
    return defaults;
  }
}

export function saveConfig(file: string, config: DesktopConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}
