import { contextBridge, ipcRenderer } from 'electron';

type Listener = (state: unknown) => void;

const api = {
  info: () => ipcRenderer.invoke('app:info'),
  saveConfig: (payload: { apiUrl: string; robotToken: string }) => ipcRenderer.invoke('config:save', payload),
  checkRobot: () => ipcRenderer.invoke('robot:check'),
  startPolling: () => ipcRenderer.invoke('poll:start'),
  stopPolling: () => ipcRenderer.invoke('poll:stop'),
  continueRun: () => ipcRenderer.invoke('run:continue'),
  abortRun: () => ipcRenderer.invoke('run:abort'),
  startRecording: (payload: { url: string; platform: string }) => ipcRenderer.invoke('record:start', payload),
  stopRecording: () => ipcRenderer.invoke('record:stop'),
  currentRecording: () => ipcRenderer.invoke('record:current'),
  discardRecording: () => ipcRenderer.invoke('record:discard'),
  saveRecording: (payload: {
    scenarioId?: string;
    name?: string;
    platform?: string;
    folder?: string;
    description?: string;
    steps?: unknown[];
    note?: string;
  }) => ipcRenderer.invoke('record:save', payload),
  scenarios: () => ipcRenderer.invoke('scenarios:list'),
  scenario: (id: string) => ipcRenderer.invoke('scenario:get', id),
  onState: (handler: Listener) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => handler(state);
    ipcRenderer.on('state', listener);
    return () => {
      ipcRenderer.removeListener('state', listener);
    };
  },
};

contextBridge.exposeInMainWorld('robot', api);
