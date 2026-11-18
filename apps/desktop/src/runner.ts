import { BrowserWindow } from 'electron';
import { AutomationError, Page } from './automation';
import type { DesktopJob, RobotClient } from './api';
import type { Step } from './types';

export interface RunnerHooks {
  log(level: 'info' | 'warn' | 'error', message: string): void;
  state(patch: {
    busy?: boolean;
    job?: { farmName: string; scenarioName: string; mode: string } | null;
    currentStep?: string | null;
    paused?: boolean;
    manual?: { message: string } | null;
    url?: string | null;
  }): void;
  manual(message: string): Promise<void>;
}

type StepContext = { job: DesktopJob; page: Page; prefix: string };

const secretOf = (job: DesktopJob, kind: 'login' | 'password' | 'eri'): string => {
  if (kind === 'login') return job.secrets.login ?? '';
  if (kind === 'password') return job.secrets.password ?? '';
  return job.secrets.eriPassword ?? '';
};

const interpolate = (template: string, job: DesktopJob): string =>
  template
    .replace(/\{\{farm\.oneCUrl\}\}/g, job.secrets.oneCUrl ?? job.farm.oneCUrl ?? '')
    .replace(/\{\{farm\.tin\}\}/g, job.farm.tin)
    .replace(/\{\{farm\.name\}\}/g, job.farm.name)
    .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key: string) => job.values[key] ?? match);

export class JobRunner {
  private win: BrowserWindow | null = null;
  private aborted = false;
  private handledIntervention = '';
  private activeJob: DesktopJob | null = null;
  private executedIrreversible = false;

  constructor(
    private client: RobotClient,
    private readonly hooks: RunnerHooks,
  ) {}

  setClient(client: RobotClient): void {
    this.client = client;
  }

  get busy(): boolean {
    return Boolean(this.win);
  }

  get window(): BrowserWindow | null {
    return this.win;
  }

  async run(job: DesktopJob): Promise<void> {
    this.aborted = false;
    this.handledIntervention = '';
    this.executedIrreversible = false;
    this.activeJob = job;
    this.hooks.state({
      busy: true,
      job: { farmName: job.farm.name, scenarioName: job.scenario.name, mode: job.mode },
      currentStep: null,
      paused: false,
      manual: null,
    });
    this.hooks.log('info', `${job.farm.name} — ${job.scenario.name} boshlandi (${job.mode}).`);

    this.win = new BrowserWindow({
      width: 1360,
      height: 900,
      title: `Buxgalter RPA — ${job.farm.name}`,
      show: true,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
    });
    this.win.on('closed', () => {
      this.win = null;
    });

    const page = new Page(this.win);
    let failure: { code: string; message: string } | null = null;

    try {
      await this.runSteps(job.scenario.steps, { job, page, prefix: '' });
      this.hooks.log('info', `${job.farm.name} — barcha qadamlar bajarildi.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof AutomationError ? error.code : 'ROBOT_ERROR';
      const unclear = this.executedIrreversible && job.mode === 'live';
      failure = unclear
        ? { code: 'POST_SIGN_UNCLEAR', message: `Imzolashdan keyin holat noaniq (${code}): ${message}` }
        : { code, message };
      this.hooks.log('error', `${job.farm.name} — xato: ${failure.message}`);
      try {
        await this.client.event(job.id, 'log', `Xato: ${message}`, { code });
      } catch {
        /* event yuborilmasa ham davom etamiz */
      }
    }

    let state: { status: string } | null = null;
    try {
      state = await this.client.runState(job.runId);
    } catch {
      state = null;
    }
    const cancelled = this.aborted || state?.status === 'cancelled';

    if (!cancelled) {
      let screenshotBase64: string | undefined;
      if (failure && this.win && !this.win.isDestroyed()) {
        try {
          screenshotBase64 = await page.screenshotBase64();
        } catch {
          screenshotBase64 = undefined;
        }
      }
      try {
        await this.client.complete(job.id, {
          ok: !failure,
          errorCode: failure?.code,
          errorMessage: failure?.message,
          screenshotBase64,
        });
      } catch (error) {
        this.hooks.log('error', `Natijani yuborishda xato: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.hooks.log('warn', 'Run bekor qilindi — robot to‘xtadi.');
    }

    job.secrets = { login: null, password: null, eriPassword: null, oneCUrl: null };
    this.activeJob = null;
    this.hooks.state({ busy: false, job: null, currentStep: null, paused: false, manual: null });
    setTimeout(() => {
      if (this.win && !this.win.isDestroyed()) this.win.close();
      this.win = null;
    }, 1200);
  }

  abort(): void {
    this.aborted = true;
  }

  private async gate(job: DesktopJob): Promise<boolean> {
    let wasPaused = false;
    let failures = 0;
    for (;;) {
      if (this.aborted) return false;
      let status: string;
      try {
        status = (await this.client.runState(job.runId)).status;
        failures = 0;
      } catch (error) {
        const code = (error as { status?: number }).status;
        if (code === 401 || code === 403) {
          throw new AutomationError('ROBOT_UNAUTHORIZED', 'Robot tokeni yaroqsiz — Sozlamalarda yangilang.');
        }
        if (code === 404) {
          throw new AutomationError('RUN_NOT_FOUND', 'Run topilmadi (o‘chirilgan bo‘lishi mumkin).');
        }
        failures += 1;
        if (failures >= 20) {
          throw new AutomationError('API_UNAVAILABLE', 'API bilan aloqa yo‘q — ijro to‘xtatildi.');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (status === 'running') {
        if (wasPaused) {
          wasPaused = false;
          this.hooks.state({ paused: false });
          this.hooks.log('info', 'Run davom ettirildi.');
        }
        return true;
      }
      if (status === 'paused') {
        wasPaused = true;
        this.hooks.state({ paused: true });
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
      this.aborted = true;
      return false;
    }
  }

  private async runSteps(steps: Step[], ctx: StepContext): Promise<void> {
    const { job, page } = ctx;
    for (const step of steps) {
      if (step.enabled === false) continue;
      if (!(await this.gate(job))) return;

      if (step.type === 'sign' && job.mode === 'dry') {
        await this.client.event(job.id, 'step_skipped', `${job.farm.name}: imzolash qadami dry run’da o‘tkazildi.`, {
          step: step.id,
        });
        this.hooks.log('warn', 'Imzolash qadami dry run’da o‘tkazib yuborildi.');
        continue;
      }
      if (step.type === 'click' && step.irreversible && job.mode === 'dry') {
        await this.client.event(job.id, 'step_skipped', `${job.farm.name}: qaytarib bo‘lmaydigan qadam dry run’da o‘tkazildi.`, {
          step: step.id,
        });
        this.hooks.log('warn', 'Qaytarib bo‘lmaydigan qadam dry run’da o‘tkazib yuborildi.');
        continue;
      }

      const label = step.description || step.type;
      this.hooks.state({ currentStep: label });
      this.hooks.log('info', `Qadam: ${label}`);
      await this.client.event(job.id, 'step', `${job.farm.name}: ${label}`, {
        step: step.id,
        type: step.type,
        irreversible: step.type === 'click' ? Boolean(step.irreversible) : false,
      });

      switch (step.type) {
        case 'navigate': {
          const url = interpolate(step.url, job);
          this.hooks.state({ url });
          await page.load(url);
          await page.wait(500);
          break;
        }
        case 'click': {
          await page.click(`${ctx.prefix}${step.selector}`);
          if (step.irreversible) this.executedIrreversible = true;
          if (step.expectedText) await page.waitForText(interpolate(step.expectedText, job), 8000);
          break;
        }
        case 'sign': {
          await page.click(`${ctx.prefix}${step.selector}`);
          this.executedIrreversible = true;
          await page.wait(900);
          break;
        }
        case 'fill': {
          const value = step.secret
            ? secretOf(job, step.secret)
            : step.variable && job.values[step.variable] !== undefined
              ? job.values[step.variable]
              : interpolate(step.value, job);
          if (step.secret && !value) {
            throw new AutomationError('SECRET_MISSING', `Maxfiy qiymat yo‘q: ${step.secret}`);
          }
          await page.fill(`${ctx.prefix}${step.selector}`, value);
          break;
        }
        case 'extract': {
          const attribute = step.attribute ?? 'text';
          const value = await page.js<string | null>(`(() => {
            const el = document.querySelector(${JSON.stringify(`${ctx.prefix}${step.selector}`)});
            if (!el) return null;
            if (${JSON.stringify(attribute)} === 'value') return String(el.value ?? '');
            if (${JSON.stringify(attribute)} === 'href') return el.getAttribute('href') ?? '';
            return (el.innerText || el.textContent || '').trim();
          })()`);
          if (value === null) {
            throw new AutomationError('EXTRACT_TARGET_MISSING', `Qiymat olinadigan element topilmadi: ${step.selector}`);
          }
          job.values[step.variable] = value;
          this.hooks.log('info', `«${step.variable}» = ${value.slice(0, 120)}`);
          break;
        }
        case 'wait': {
          if (step.selector) await page.waitForSelector(`${ctx.prefix}${step.selector}`, 20_000);
          const ms = step.ms ?? 600;
          const until = Date.now() + ms;
          while (Date.now() < until) {
            if (!(await this.gate(job))) return;
            await page.wait(Math.min(400, until - Date.now()));
          }
          break;
        }
        case 'check': {
          if (step.selector) await page.waitForSelector(`${ctx.prefix}${step.selector}`, 10_000);
          if (step.text) await page.waitForText(interpolate(step.text, job), 12_000);
          break;
        }
        case 'eimzo-login': {
          await this.eimzoLogin(ctx);
          break;
        }
        case 'password-login': {
          await this.passwordLogin(ctx);
          break;
        }
        case 'manual': {
          await this.client.event(job.id, 'manual_required', step.reason ?? 'Qo‘l bilan davom ettirish kerak.');
          await this.askManual(step.reason ?? 'Qo‘l bilan davom ettirish kerak');
          break;
        }
        case 'loop': {
          const count = await page.js<number>(`document.querySelectorAll(${JSON.stringify(`${ctx.prefix}${step.selector}`)}).length`);
          for (let index = 0; index < count; index += 1) {
            if (!(await this.gate(job))) return;
            const marker = `${ctx.prefix}${step.selector}`;
            await page.js(`(() => {
              const nodes = document.querySelectorAll(${JSON.stringify(marker)});
              const node = nodes[${index}];
              if (node) node.setAttribute('data-rpa-loop', '${index}');
            })()`);
            await this.runSteps(step.steps, { job, page, prefix: `[data-rpa-loop="${index}"] ` });
          }
          break;
        }
        case 'condition': {
          const matches = await page.js<boolean>(`(() => {
            const el = document.querySelector(${JSON.stringify(`${ctx.prefix}${step.selector}`)});
            const body = el ? el.textContent || '' : (document.body ? document.body.innerText : '');
            return Boolean(el) || Boolean(body);
          })()`);
          await this.runSteps(matches ? step.then : step.otherwise, ctx);
          break;
        }
        default:
          break;
      }

      const danger = await page.detectIntervention().catch(() => null);
      if (danger && !this.handledIntervention && danger !== this.handledIntervention) {
        this.handledIntervention = danger;
        await this.client.event(job.id, 'manual_required', 'CAPTCHA / SMS tasdiqlash aniqlandi — buxgalter davom ettiradi.');
        await this.askManual('Sahifada CAPTCHA yoki SMS tasdiqlash bor. Buxgalter bajarib, «Davom etish»ni bosing.');
      }
    }
  }

  private async askManual(message: string): Promise<void> {
    this.hooks.state({ manual: { message } });
    let released = false;
    const manual = this.hooks.manual(message).then(() => {
      released = true;
    });
    while (!released) {
      await Promise.race([manual, new Promise((resolve) => setTimeout(resolve, 1500))]);
      if (released || this.aborted) break;
      const job = this.activeJob;
      if (!job) break;
      try {
        const status = (await this.client.runState(job.runId)).status;
        if (status !== 'running' && status !== 'paused') {
          this.aborted = true;
          this.hooks.log('warn', 'Run yopildi — qo‘l kutish bekor qilindi.');
          break;
        }
      } catch {
        /* aloqa yo‘q — kutishda davom etamiz */
      }
    }
    this.hooks.state({ manual: null });
    if (released) await manual;
  }

  private async findVisible(page: Page, selectors: string[]): Promise<string | null> {
    for (const selector of selectors) {
      const hit = await page.js<string | null>(`(() => {
        const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const visible = nodes.find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        });
        if (!visible) return null;
        visible.setAttribute('data-rpa-visible', '1');
        return '[data-rpa-visible="1"]';
      })()`);
      if (hit) {
        await page.js(`document.querySelector('[data-rpa-visible="1"]')?.removeAttribute('data-rpa-visible')`);
        return selector;
      }
    }
    return null;
  }

  private async eimzoLogin(ctx: StepContext): Promise<void> {
    const { job, page } = ctx;
    const passwordAlready = await this.findVisible(page, ['input[type="password"]']);

    const opened = await page.clickByText('E-IMZO|ЭЦП|ERI|ЭРИ|kalit bilan kirish', 'body');
    if (opened) {
      this.hooks.log('info', 'E-IMZO oynasi ochilmoqda…');
      await page.wait(1200);
    } else if (!passwordAlready) {
      this.hooks.log('warn', 'E-IMZO tugmasi topilmadi. Qo‘lda kirish kerak.');
      await this.askManual('E-IMZO tugmasi topilmadi. Saytga E-IMZO bilan qo‘lda kiring va «Davom etish»ni bosing.');
      return;
    }

    const keySelector = await page.js<string | null>(`(() => {
      const selectors = ['.key-item', '[data-key-id]', '.key-list button', '[role="option"]'];
      for (const selector of selectors) {
        const nodes = [...document.querySelectorAll(selector)].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        });
        if (nodes[0]) {
          nodes[0].setAttribute('data-rpa-key', '1');
          return '[data-rpa-key="1"]';
        }
      }
      return null;
    })()`);
    if (keySelector) {
      await page.click(keySelector);
      this.hooks.log('info', 'E-IMZO kaliti tanlandi.');
      await page.wait(400);
    }

    const passwordSelector = await this.findVisible(page, ['input[type="password"]']);
    if (passwordSelector) {
      if (!job.secrets.eriPassword) {
        await this.client.event(job.id, 'manual_required', 'ERI paroli saqlanmagan — buxgalter kiritadi.');
        await this.askManual('ERI paroli saqlanmagan. E-IMZO oynasida parolni qo‘lda kiriting va «Davom etish»ni bosing.');
        return;
      }
      await page.fill(passwordSelector, job.secrets.eriPassword);
      this.hooks.log('info', 'ERI paroli E-IMZO oynasiga kiritildi.');
    }

    const confirmed = await page.clickByText('Tasdiqlash|Подтвердить|Kirish|Войти|Continue|Davom etish', 'body');
    if (!confirmed) {
      await this.client.event(job.id, 'manual_required', 'E-IMZO tasdiqlash tugmasi topilmadi.');
      await this.askManual('E-IMZO oynasida tasdiqlashni yakunlang va «Davom etish»ni bosing.');
      return;
    }

    await page.wait(2000);
    const stillPassword = await this.findVisible(page, ['input[type="password"]']);
    if (stillPassword) {
      await this.client.event(job.id, 'manual_required', 'E-IMZO kirishi yakunlanmadi — buxgalter tekshiradi.');
      await this.askManual('E-IMZO kirishi yakunlanmadi. Kalitni tanlab, parolni kiriting va «Davom etish»ni bosing.');
    }
  }

  private async passwordLogin(ctx: StepContext): Promise<void> {
    const { job, page } = ctx;
    const loginSelector = await this.findVisible(page, [
      'input[type="email"]',
      'input[name*="login" i]',
      'input[name*="user" i]',
      'input[autocomplete="username"]',
      'input[type="text"]',
    ]);
    const passwordSelector = await this.findVisible(page, ['input[type="password"]']);
    if (!loginSelector || !passwordSelector) {
      await this.client.event(job.id, 'manual_required', 'Login/parol maydoni topilmadi.');
      await this.askManual('Login yoki parol maydoni topilmadi. Qo‘lda kirib, «Davom etish»ni bosing.');
      return;
    }
    if (!job.secrets.login || !job.secrets.password) {
      throw new AutomationError('SECRET_MISSING', 'Login yoki parol saqlanmagan');
    }
    await page.fill(loginSelector, job.secrets.login);
    await page.fill(passwordSelector, job.secrets.password);
    const clicked = await page.clickByText('Kirish|Войти|Login|Sign in|Continue', 'body');
    if (!clicked) await page.pressEnter();
    await page.wait(1800);

    const stillPassword = await this.findVisible(page, ['input[type="password"]']);
    if (stillPassword) {
      await this.client.event(job.id, 'manual_required', 'Parol bilan kirish yakunlanmadi.');
      await this.askManual('Kirish yakunlanmadi (CAPTCHA/SMS bo‘lishi mumkin). Qo‘lda yakunlab, «Davom etish»ni bosing.');
    }
  }
}
