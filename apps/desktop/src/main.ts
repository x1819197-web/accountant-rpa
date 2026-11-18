import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, RobotClient, saveConfig, type DesktopConfig, type ScenarioSummary } from './api';
import { Recorder } from './recorder';
import { JobRunner } from './runner';
import type { Step } from './types';

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  at: string;
  level: LogLevel;
  message: string;
}

interface ManualGate {
  message: string;
}

interface RecordingResult {
  steps: Step[];
  platform: string;
  startUrl: string;
}

interface AppState {
  connected: boolean;
  polling: boolean;
  busy: boolean;
  job: { farmName: string; scenarioName: string; mode: string } | null;
  currentStep: string | null;
  paused: boolean;
  manual: ManualGate | null;
  recorder: { count: number; lastEvent: string; platform: string; url: string } | null;
  recorded: { steps: number; platform: string; startUrl: string } | null;
  log: LogEntry[];
}

const state: AppState = {
  connected: false,
  polling: false,
  busy: false,
  job: null,
  currentStep: null,
  paused: false,
  manual: null,
  recorder: null,
  recorded: null,
  log: [],
};

let configFile = '';
let config: DesktopConfig = { apiUrl: 'http://localhost:3100', robotToken: '' };
let client = new RobotClient(config.apiUrl, config.robotToken);
let controlWin: BrowserWindow | null = null;
let recorderWin: BrowserWindow | null = null;
let recorder: Recorder | null = null;
let recording: RecordingResult | null = null;
let lastRecorderPlatform = 'didox';
let lastRecorderUrl = 'http://localhost:3100/demo/didox.html';

let polling = false;
let pollTimer: NodeJS.Timeout | null = null;
let pollBusy = false;
let waitingManual: (() => void) | null = null;
let manualBeep: NodeJS.Timeout | null = null;

function alertAccountant(): void {
  shell.beep();
  if (manualBeep) clearInterval(manualBeep);
  manualBeep = setInterval(() => shell.beep(), 20_000);
  if (controlWin && !controlWin.isDestroyed()) {
    if (controlWin.isMinimized()) controlWin.restore();
    controlWin.show();
    controlWin.focus();
    controlWin.flashFrame(true);
  }
}

function stopAccountantAlert(): void {
  if (manualBeep) {
    clearInterval(manualBeep);
    manualBeep = null;
  }
  if (controlWin && !controlWin.isDestroyed()) controlWin.flashFrame(false);
}

const runner = new JobRunner(client, {
  log(level, message) {
    pushLog(level, message);
  },
  state(patch) {
    Object.assign(state, patch);
    broadcast();
  },
  manual(message) {
    state.manual = { message };
    broadcast();
    alertAccountant();
    return new Promise<void>((resolve) => {
      waitingManual = () => {
        waitingManual = null;
        state.manual = null;
        stopAccountantAlert();
        broadcast();
        resolve();
      };
    });
  },
});

function pushLog(level: LogLevel, message: string): void {
  state.log.push({ at: new Date().toISOString(), level, message });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  broadcast();
}

function snapshot() {
  return {
    ...state,
    config: { apiUrl: config.apiUrl, hasToken: Boolean(config.robotToken) },
    configFile,
    version: app.getVersion(),
    appVersion: '0.1.0',
  };
}

function broadcast(): void {
  if (controlWin && !controlWin.isDestroyed()) {
    controlWin.webContents.send('state', snapshot());
  }
}

function createControlWindow(): void {
  controlWin = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    title: 'Buxgalter RPA — Desktop robot',
    backgroundColor: '#f7f6f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  controlWin.on('closed', () => {
    stopAccountantAlert();
    controlWin = null;
  });
}

function closeRecorder(): void {
  if (recorderWin && !recorderWin.isDestroyed()) recorderWin.close();
}

async function finishRecording(): Promise<void> {
  if (!recorder) return;
  const current = recorder;
  const platform = current.platformId;
  const startUrl = lastRecorderUrl;
  recorder = null;
  try {
    const steps = await current.stop();
    recording = { steps, platform, startUrl };
    state.recorded = { steps: steps.length, platform, startUrl };
    state.recorder = null;
    pushLog('info', `Yozib olish yakunlandi: ${steps.length} qadam.`);
  } catch (error) {
    state.recorder = null;
    pushLog('error', `Yozib olishni yakunlashda xato: ${error instanceof Error ? error.message : String(error)}`);
  }
  broadcast();
}

function openRecorder(url: string, platform: string): { ok: boolean; message?: string } {
  closeRecorder();
  lastRecorderUrl = url;
  lastRecorderPlatform = platform;
  recorderWin = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Buxgalter RPA — Yozib olish',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  recorderWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (recorderWin && !recorderWin.isDestroyed() && /^https?:\/\//i.test(target)) {
      void recorderWin.loadURL(target);
    }
    return { action: 'deny' };
  });

  recorder = new Recorder(recorderWin, platform, (count, lastEvent) => {
    state.recorder = { count, lastEvent, platform, url: recorderWin?.webContents.getURL() ?? url };
    broadcast();
  });

  recorderWin.on('closed', () => {
    recorderWin = null;
    if (recorder) void finishRecording();
  });

  state.recorder = { count: 0, lastEvent: 'Sahifa ochilmoqda…', platform, url };
  broadcast();

  recorder
    .start(url)
    .then(() => {
      pushLog('info', `Yozib olish boshlandi: ${url}`);
    })
    .catch((error: unknown) => {
      pushLog('error', `Sahifani ochib bo‘lmadi: ${error instanceof Error ? error.message : String(error)}`);
      state.recorder = null;
      broadcast();
    });

  return { ok: true };
}

function schedulePoll(delay = 2500): void {
  if (!polling) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    void pollOnce();
  }, delay);
}

async function pollOnce(): Promise<void> {
  if (!polling || pollBusy) return;
  pollBusy = true;
  let nextDelay: number | undefined;
  try {
    const result = await client.nextJob();
    state.connected = true;
    if (result.job && !state.busy) {
      await runner.run(result.job);
    } else if (result.state === 'waiting' && result.retryInMs) {
      nextDelay = Math.max(500, result.retryInMs);
    }
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    if (typed.status === 401) {
      state.connected = false;
      stopPolling();
      pushLog('error', 'Robot tokeni yaroqsiz. Sozlamalarda yangi token kiriting.');
    } else if (typed.status === 423) {
      state.connected = true;
      if (!state.log.some((entry) => entry.message.includes('Ombor qulf'))) {
        pushLog('warn', 'Ombor qulf — web ilovada master parol bilan kiring.');
      }
    } else {
      state.connected = false;
      const message = `API bilan aloqa yo‘q: ${typed.message}`;
      const last = state.log[state.log.length - 1];
      if (!last || !last.message.startsWith('API bilan aloqa yo‘q')) pushLog('warn', message);
    }
  } finally {
    pollBusy = false;
    schedulePoll(nextDelay);
  }
}

function startPolling(): { ok: boolean; message?: string } {
  if (polling) return { ok: true };
  if (!config.robotToken) return { ok: false, message: 'Robot tokeni kiritilmagan.' };
  polling = true;
  state.polling = true;
  pushLog('info', 'Navbat kuzatilmoqda…');
  void pollOnce();
  return { ok: true };
}

function stopPolling(): void {
  polling = false;
  state.polling = false;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pushLog('info', 'Navbat kuzatish to‘xtatildi.');
}

function applyConfig(next: DesktopConfig): void {
  config = next;
  client = new RobotClient(config.apiUrl, config.robotToken);
  runner.setClient(client);
  saveConfig(configFile, config);
  state.connected = false;
  broadcast();
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => snapshot());

  ipcMain.handle('config:save', async (_event, payload: { apiUrl: string; robotToken: string }) => {
    const apiUrl = payload.apiUrl.trim() || 'http://localhost:3100';
    const typedToken = payload.robotToken.trim();
    const robotToken = typedToken || config.robotToken;
    const wasPolling = polling;
    if (wasPolling) stopPolling();
    applyConfig({ apiUrl, robotToken });
    lastRecorderUrl = `${apiUrl.replace(/\/+$/, '')}/demo/didox.html`;
    try {
      await client.health();
      state.connected = true;
      broadcast();
      pushLog('info', `API ulanish tekshirildi: ${apiUrl}`);
      return { ok: true };
    } catch (error) {
      state.connected = false;
      broadcast();
      return { ok: false, message: `API javob bermadi: ${error instanceof Error ? error.message : String(error)}` };
    }
  });

  ipcMain.handle('robot:check', async () => {
    try {
      await client.health();
      state.connected = true;
      try {
        const list = await client.scenarios();
        broadcast();
        return { ok: true, tokenOk: true, scenarios: list.scenarios.length };
      } catch (error) {
        state.connected = true;
        broadcast();
        return { ok: true, tokenOk: false, message: error instanceof Error ? error.message : String(error) };
      }
    } catch (error) {
      state.connected = false;
      broadcast();
      return { ok: false, tokenOk: false, message: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('poll:start', () => startPolling());
  ipcMain.handle('poll:stop', () => {
    stopPolling();
    return { ok: true };
  });

  ipcMain.handle('run:continue', () => {
    if (waitingManual) waitingManual();
    return { ok: true };
  });

  ipcMain.handle('run:abort', () => {
    runner.abort();
    if (waitingManual) waitingManual();
    pushLog('warn', 'Bekor qilish so‘raldi.');
    return { ok: true };
  });

  ipcMain.handle('record:start', (_event, payload: { url?: string; platform?: string }) => {
    const url = (payload.url || lastRecorderUrl).trim();
    const platform = payload.platform || 'didox';
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: 'URL http(s) bilan boshlanishi kerak.' };
    if (recorder) {
      void finishRecording();
    }
    return openRecorder(url, platform);
  });

  ipcMain.handle('record:stop', async () => {
    if (!recorder) {
      return { ok: false, message: 'Yozib olish faol emas.', steps: recording?.steps ?? [] };
    }
    await finishRecording();
    closeRecorder();
    return { ok: true, steps: recording?.steps ?? [] };
  });

  ipcMain.handle('record:current', () => ({
    ok: true,
    recording: recording ? { steps: recording.steps, platform: recording.platform, startUrl: recording.startUrl } : null,
  }));

  ipcMain.handle('record:discard', () => {
    recording = null;
    state.recorded = null;
    broadcast();
    return { ok: true };
  });

  ipcMain.handle(
    'record:save',
    async (
      _event,
      payload: {
        scenarioId?: string;
        name?: string;
        platform?: string;
        folder?: string;
        description?: string;
        steps?: Step[];
        note?: string;
      },
    ) => {
      const steps = payload.steps?.length ? payload.steps : recording?.steps ?? [];
      if (!steps.length) return { ok: false, message: 'Saqlash uchun qadamlar yo‘q.' };
      try {
        if (payload.scenarioId) {
          const existing = await client.scenario(payload.scenarioId);
          const saved = await client.saveScenario(payload.scenarioId, {
            steps,
            variables: existing.variables,
            note: payload.note || 'Desktop robotda qayta yozildi',
          });
          pushLog('info', `Scenario yangilandi: ${saved.scenario.name} (v${saved.scenario.version}).`);
          return { ok: true, scenario: saved.scenario };
        }
        const name = (payload.name || '').trim();
        if (name.length < 2) return { ok: false, message: 'Scenario nomi kamida 2 belgi bo‘lishi kerak.' };
        const created = await client.createScenario({
          name,
          platform: payload.platform || recording?.platform || 'didox',
          folder: payload.folder?.trim() || undefined,
          description: payload.description?.trim() || `Desktop robotda yozildi: ${recording?.startUrl ?? ''}`,
          steps,
          variables: [],
          note: payload.note || 'Desktop robotda yozildi',
        });
        pushLog('info', `Yangi scenario: ${created.scenario.name} (v${created.scenario.version}).`);
        return { ok: true, scenario: created.scenario };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushLog('error', `Scenarioni saqlashda xato: ${message}`);
        return { ok: false, message };
      }
    },
  );

  ipcMain.handle('scenarios:list', async () => {
    try {
      const result = await client.scenarios();
      return { ok: true, scenarios: result.scenarios as ScenarioSummary[] };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
  });

  ipcMain.handle('scenario:get', async (_event, id: string) => {
    try {
      const result = await client.scenario(id);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controlWin) {
      if (controlWin.isMinimized()) controlWin.restore();
      controlWin.focus();
    }
  });

  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'), 'robot-config.json');
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    config = loadConfig(configFile);
    client = new RobotClient(config.apiUrl, config.robotToken);
    runner.setClient(client);
    lastRecorderUrl = `${config.apiUrl.replace(/\/+$/, '')}/demo/didox.html`;

    registerIpc();
    createControlWindow();

    if (process.env.RPA_AUTOSTART === '1' && config.robotToken) {
      setTimeout(() => {
        pushLog('info', 'Avtomatik ishga tushish (RPA_AUTOSTART=1).');
        startPolling();
      }, 1500);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
    });
  });

  app.on('window-all-closed', () => {
    void (async () => {
      if (recorder) await finishRecording();
      if (polling) stopPolling();
      app.quit();
    })();
  });
}
