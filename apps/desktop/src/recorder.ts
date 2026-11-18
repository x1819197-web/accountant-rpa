import type { BrowserWindow } from 'electron';
import type { Step } from './types';

interface RawEvent {
  kind: 'click' | 'fill' | 'select' | 'nav';
  selector?: string;
  text?: string;
  value?: string;
  secret?: 'login' | 'password' | 'eri';
  url?: string;
  label?: string;
  ts: number;
}

const INSTRUMENT = `(() => {
  if (window.__rpaRecInstalled) return;
  window.__rpaRecInstalled = true;

  const send = (payload) => {
    try { window.__rpaRecord(JSON.stringify(payload)); } catch (error) { /* binding yo'q */ }
  };

  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\\\' + ch);
  };

  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch (error) { return false; }
  };

  const quote = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');

  const buildSelector = (element) => {
    if (!element || element.nodeType !== 1) return null;
    if (element.id) {
      const byId = '#' + cssEscape(element.id);
      if (unique(byId)) return byId;
    }
    for (const attr of ['data-testid', 'data-test', 'data-action', 'data-key-id', 'name', 'placeholder']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const candidate = element.tagName.toLowerCase() + '[' + attr + '="' + quote(value) + '"]';
      if (unique(candidate)) return candidate;
    }
    const aria = element.getAttribute('aria-label');
    if (aria) {
      const candidate = element.tagName.toLowerCase() + '[aria-label="' + quote(aria) + '"]';
      if (unique(candidate)) return candidate;
    }
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (child) => child.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (unique(candidate)) return candidate;
      node = parent;
    }
    return parts.join(' > ');
  };

  const clean = (text) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 80);

  const labelOf = (element) => {
    const parts = [
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      element.getAttribute('name'),
      element.id,
    ];
    if (element.id) {
      const label = document.querySelector('label[for="' + cssEscape(element.id) + '"]');
      if (label) parts.unshift(label.innerText);
    }
    const parentLabel = element.closest('label');
    if (parentLabel) parts.push(parentLabel.innerText);
    return clean(parts.find((part) => part && clean(part)) || '');
  };

  const isEimzoContext = (element) => {
    const dialog = element.closest('[role="dialog"], dialog, .modal, .modal-body, form[data-eimzo], #eimzo-modal');
    const scope = dialog || document.body;
    return /E-IMZO|ЭЦП|ERI|ЭРИ/i.test(scope.innerText || '');
  };

  const actionable = (target) => {
    if (!target || target.nodeType !== 1) return null;
    if (target.closest('[data-rpa-ignore]')) return null;
    if (target === document.body || target === document.documentElement) return null;
    if (target.tagName === 'OPTION') return null;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
      const type = (target.getAttribute('type') || 'text').toLowerCase();
      if (!['submit', 'button', 'checkbox', 'radio'].includes(type)) {
        const label = target.closest('label');
        const control = label && label.control;
        if (control && (control.type === 'checkbox' || control.type === 'radio')) {
          return control;
        }
        return null;
      }
    }
    const hit = target.closest('a,button,[role="button"],input[type=submit],input[type=button],input[type=checkbox],input[type=radio],summary,[data-action],[onclick]');
    if (hit) return hit;
    const label = target.closest('label');
    if (label) {
      const control = label.control;
      if (control && (control.type === 'checkbox' || control.type === 'radio')) return control;
    }
    return null;
  };

  document.addEventListener('click', (event) => {
    const target = actionable(event.target);
    if (!target) return;
    const selector = buildSelector(target);
    if (!selector) return;
    const text = clean(target.innerText || target.value || target.getAttribute('aria-label') || '');
    send({ kind: 'click', selector, text, ts: Date.now() });
  }, true);

  const isCheckable = (element) =>
    element.tagName === 'INPUT' && (element.type === 'checkbox' || element.type === 'radio');

  document.addEventListener('change', (event) => {
    const element = event.target;
    if (!element || element.nodeType !== 1) return;
    if (isCheckable(element)) return;
    const tag = element.tagName;
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (element.disabled) return;
    const selector = buildSelector(element);
    if (!selector) return;
    const label = labelOf(element);

    if (tag === 'SELECT') {
      send({ kind: 'select', selector, value: element.value, label, ts: Date.now() });
      return;
    }
    if (element.type === 'password') {
      send({
        kind: 'fill',
        selector,
        value: '',
        secret: isEimzoContext(element) ? 'eri' : 'password',
        label,
        ts: Date.now(),
      });
      return;
    }
    const hints = [element.name, element.id, element.autocomplete].join(' ').toLowerCase();
    if (element.type === 'email' || /username|login|user|email/.test(hints)) {
      send({ kind: 'fill', selector, value: '', secret: 'login', label, ts: Date.now() });
      return;
    }
    const value = element.value;
    if (!value || value.length > 200) return;
    send({ kind: 'fill', selector, value, label, ts: Date.now() });
  }, true);
})();`;

function stepId(index: number): string {
  return `rec-${Date.now().toString(36)}-${index}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
  } catch {
    return url;
  }
}

function eventToStep(event: RawEvent, index: number): Step | null {
  if (event.kind === 'nav') {
    if (!event.url) return null;
    return { id: stepId(index), type: 'navigate', url: event.url, description: `Sahifa: ${pageLabel(event.url)}` };
  }
  if (!event.selector) return null;
  if (event.kind === 'click') {
    const description = event.text ? `Bosish: ${event.text}` : `Bosish: ${event.selector}`;
    return { id: stepId(index), type: 'click', selector: event.selector, description };
  }
  if (event.kind === 'fill') {
    const label = event.label || event.selector;
    return {
      id: stepId(index),
      type: 'fill',
      selector: event.selector,
      value: event.secret ? '' : event.value ?? '',
      ...(event.secret ? { secret: event.secret } : {}),
      description: event.secret ? `Maxfiy kiritish: ${label}` : `To‘ldirish: ${label}`,
    };
  }
  if (event.kind === 'select') {
    return {
      id: stepId(index),
      type: 'fill',
      selector: event.selector,
      value: event.value ?? '',
      description: `Tanlash: ${event.label || event.selector} — ${event.value ?? ''}`,
    };
  }
  return null;
}

export class Recorder {
  private attached = false;
  private raw: RawEvent[] = [];
  private playing = false;
  private lastNav = '';
  private onCount: (count: number, lastEvent: string) => void;
  private navListener: ((event: Electron.Event, url: string) => void) | null = null;
  private debugListener:
    | ((event: Electron.Event, method: string, params: unknown, sessionId: string) => void)
    | null = null;

  constructor(
    private readonly win: BrowserWindow,
    private readonly platform: string,
    onCount: (count: number, lastEvent: string) => void,
  ) {
    this.onCount = onCount;
  }

  get isRecording(): boolean {
    return this.playing;
  }

  get window(): BrowserWindow {
    return this.win;
  }

  async start(url: string): Promise<void> {
    this.raw = [{ kind: 'nav', url, ts: Date.now() }];
    this.lastNav = url;
    this.playing = true;

    this.navListener = (_event, targetUrl) => {
      if (!this.playing) return;
      if (targetUrl === this.lastNav) return;
      this.lastNav = targetUrl;
      this.push({ kind: 'nav', url: targetUrl, ts: Date.now() });
    };
    this.win.webContents.on('did-navigate', this.navListener);

    await withTimeout(this.win.loadURL(url), 45_000, `Sahifa ochilmadi: ${url}`);
    if (this.win.isDestroyed()) throw new Error('Yozish oynasi yopildi.');

    const debuggerApi = this.win.webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    this.attached = true;

    this.debugListener = (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled') return;
      const payload = params as { name?: string; payload?: string };
      if (payload.name !== '__rpaRecord' || !payload.payload) return;
      try {
        const parsed = JSON.parse(payload.payload) as RawEvent;
        this.push(parsed);
      } catch {
        /* noto'g'ri payload */
      }
    };
    debuggerApi.on('message', this.debugListener);

    await withTimeout(debuggerApi.sendCommand('Runtime.enable'), 8_000, 'Runtime.enable kutulmadi');
    await withTimeout(debuggerApi.sendCommand('Runtime.addBinding', { name: '__rpaRecord' }), 8_000, 'addBinding kutulmadi');
    await withTimeout(debuggerApi.sendCommand('Page.enable'), 8_000, 'Page.enable kutulmadi');
    try {
      await withTimeout(
        debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT }),
        8_000,
        'addScript kutulmadi',
      );
    } catch {
      /* keyingi sahifalarga skript qo‘shilmasa ham joriy sahifa yoziladi */
    }

    await this.instrumentCurrentPage();
    this.onCount(this.raw.length, 'Yozib olish boshlandi');
  }

  private async instrumentCurrentPage(): Promise<void> {
    if (!this.attached) return;
    try {
      await withTimeout(this.win.webContents.executeJavaScript(INSTRUMENT, true), 8_000, 'instrument kutulmadi');
    } catch {
      /* sahifa hali tayyor emas — addScript keyingi navigatsiyada ishlaydi */
    }
  }

  private push(event: RawEvent): void {
    const last = this.raw[this.raw.length - 1];
    if (last && last.kind === event.kind && last.selector === event.selector && last.value === event.value) {
      if (event.kind !== 'nav') return;
    }
    if (event.kind === 'nav' && last?.kind === 'nav' && last.url === event.url) return;
    this.raw.push(event);
    const label =
      event.kind === 'click'
        ? `Bosish: ${event.text || event.selector || ''}`
        : event.kind === 'nav'
          ? `Sahifa: ${pageLabel(event.url || '')}`
          : `${event.kind === 'select' ? 'Tanlash' : 'To‘ldirish'}: ${event.label || event.selector || ''}`;
    this.onCount(this.raw.length, label);
  }

  async stop(): Promise<Step[]> {
    this.playing = false;
    if (this.navListener) {
      this.win.webContents.removeListener('did-navigate', this.navListener);
      this.navListener = null;
    }
    if (this.attached) {
      const debuggerApi = this.win.webContents.debugger;
      if (this.debugListener) {
        debuggerApi.removeListener('message', this.debugListener);
        this.debugListener = null;
      }
      try {
        if (debuggerApi.isAttached()) debuggerApi.detach();
      } catch {
        /* allaqachon uzilgan */
      }
      this.attached = false;
    }
    const steps: Step[] = [];
    for (const event of this.raw) {
      const step = eventToStep(event, steps.length);
      if (step) steps.push(step);
    }
    return steps;
  }

  get platformId(): string {
    return this.platform;
  }

  get count(): number {
    return this.raw.length;
  }
}
