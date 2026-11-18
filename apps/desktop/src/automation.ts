import type { BrowserWindow } from 'electron';

export class AutomationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export const DANGER_PATTERN = /captcha|капча|sms|смс|kod yuborildi|код подтверждения|тасдиқлаш коди/i;

export class Page {
  constructor(private readonly win: BrowserWindow) {}

  get webContents() {
    return this.win.webContents;
  }

  async js<T = unknown>(code: string): Promise<T> {
    return this.win.webContents.executeJavaScript(code, true) as Promise<T>;
  }

  async load(url: string, timeoutMs = 30_000): Promise<void> {
    await Promise.race([
      this.win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new AutomationError('NAVIGATION_TIMEOUT', `Sahifa ochilmadi: ${url}`)), timeoutMs)),
    ]);
  }

  async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForSelector(selector: string, timeoutMs = 15_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = await this.js<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (found) return;
      await this.wait(150);
    }
    throw new AutomationError('SELECTOR_NOT_FOUND', `Element topilmadi: ${selector}`);
  }

  async waitForText(text: string, timeoutMs = 15_000): Promise<void> {
    const needle = text.toLowerCase();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const body = await this.bodyText();
      if (body.toLowerCase().includes(needle)) return;
      await this.wait(200);
    }
    throw new AutomationError('TEXT_NOT_FOUND', `Sahifada matn topilmadi: ${text}`);
  }

  async bodyText(): Promise<string> {
    return this.js<string>('document.body ? document.body.innerText : ""');
  }

  async click(selector: string): Promise<void> {
    const rect = await this.js<{ x: number; y: number; w: number; h: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      el.focus && el.focus();
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 20), w: r.width, h: r.height };
    })()`);
    if (!rect) throw new AutomationError('CLICK_TARGET_MISSING', `Bosish elementi topilmadi: ${selector}`);
    if (rect.w === 0 || rect.h === 0) throw new AutomationError('CLICK_TARGET_HIDDEN', `Bosish elementi ko‘rinmaydi: ${selector}`);
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    this.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    this.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    this.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await this.wait(120);
  }

  async clickByText(pattern: string, scopeSelector = 'body'): Promise<boolean> {
    const selector = await this.js<string | null>(`(() => {
      const re = new RegExp(${JSON.stringify(pattern)}, 'i');
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
      };
      const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, .modal, .modal-back, .modal-content')]
        .filter(visible);
      const modal = dialogs.length ? dialogs[dialogs.length - 1] : null;
      const scope = modal ?? document.querySelector(${JSON.stringify(scopeSelector)});
      if (!scope) return null;
      const nodes = [...scope.querySelectorAll('button, a, [role="button"], input[type=submit]')];
      const target = nodes.find((node) => {
        const text = (node.innerText || node.value || node.getAttribute('aria-label') || '').trim();
        return text && re.test(text) && !node.disabled && visible(node);
      });
      if (!target) return null;
      target.setAttribute('data-rpa-target', 'hit');
      return '[data-rpa-target="hit"]';
    })()`);
    if (!selector) return false;
    await this.click(selector);
    await this.js(`document.querySelector('[data-rpa-target="hit"]')?.removeAttribute('data-rpa-target')`);
    return true;
  }

  async fill(selector: string, value: string): Promise<void> {
    const exists = await this.js<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!exists) throw new AutomationError('FILL_TARGET_MISSING', `Maydon topilmadi: ${selector}`);
    const isNativeSelect = await this.js<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return Boolean(el && el.tagName === 'SELECT');
    })()`);
    if (isNativeSelect) {
      const ok = await this.js<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      if (!ok) throw new AutomationError('SELECT_NOT_FOUND', `Tanlash maydoni topilmadi: ${selector}`);
      await this.wait(60);
      return;
    }
    const rect = await this.js<{ x: number; y: number } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      const r = el.getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    })()`);
    if (rect) {
      this.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
      this.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 });
    }
    await this.js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el && el.select) el.select(); })()`);
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    if (value.length > 0) {
      this.webContents.insertText(value);
    }
    await this.js(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await this.wait(80);
  }

  async selectOption(selector: string, value: string): Promise<void> {
    const ok = await this.js<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    if (!ok) throw new AutomationError('SELECT_NOT_FOUND', `Tanlash maydoni topilmadi: ${selector}`);
  }

  async pressEnter(): Promise<void> {
    this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    this.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await this.wait(150);
  }

  async exists(selector: string): Promise<boolean> {
    return this.js<boolean>(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  }

  async visible(selector: string): Promise<boolean> {
    return this.js<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })()`);
  }

  async url(): Promise<string> {
    return this.webContents.getURL();
  }

  async screenshotBase64(): Promise<string> {
    const image = await this.webContents.capturePage();
    return image.toPNG().toString('base64');
  }

  async detectIntervention(): Promise<string | null> {
    const text = await this.bodyText();
    return DANGER_PATTERN.test(text) ? text.slice(0, 200) : null;
  }
}
