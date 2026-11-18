import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, Copy, Cpu, Database, KeyRound, Monitor, Save, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cx, formatDateTime } from '@/lib/format';
import type { Settings } from '@/lib/types';
import { Badge, Button, Card, Field, Input, PageHeader, PageLoader } from '@/components/ui';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const [runnerMode, setRunnerMode] = useState<'simulated' | 'desktop'>('simulated');
  const [minutes, setMinutes] = useState(12);
  const [stopOnError, setStopOnError] = useState(false);
  const [farmWait, setFarmWait] = useState(3);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

  useEffect(() => {
    if (!settings.data || loaded) return;
    setRunnerMode(settings.data.runnerMode);
    setMinutes(settings.data.manualMinutesPerFarm);
    setStopOnError(settings.data.stopOnError);
    setFarmWait(settings.data.farmWaitSeconds);
    setLoaded(true);
  }, [settings.data, loaded]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/settings', {
        runnerMode,
        manualMinutesPerFarm: minutes,
        stopOnError,
        farmWaitSeconds: farmWait,
      });
      toast.success('Sozlamalar saqlandi.');
      setLoaded(false);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      await queryClient.invalidateQueries({ queryKey: ['metrics'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const loadToken = async () => {
    setTokenBusy(true);
    try {
      const result = await api.get<{ token: string; expiresInDays: number }>('/auth/robot-token');
      setToken(result.token);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setTokenBusy(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token nusxalandi.');
    } catch {
      toast.error('Nusxalab bo‘lmadi — qo‘lda belgilang.');
    }
  };

  if (settings.isPending) return <PageLoader />;

  const modes = [
    {
      id: 'simulated' as const,
      title: 'Simulyatsiya',
      icon: Sparkles,
      description: 'Xavfsiz sinov rejimi. Run’lar API ichida bajariladi — hech qaysi saytga chiqilmaydi, hech narsa yaratilmaydi.',
      badge: 'Demo / sinov',
    },
    {
      id: 'desktop' as const,
      title: 'Desktop robot',
      icon: Bot,
      description: 'Desktop ilova navbatdan job olib, haqiqiy brauzerda scenariyni bajaradi. Kalitlar shu kompyuterda qoladi.',
      badge: 'Haqiqiy ijro',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sozlamalar"
        description="Ijro rejimi, vaqt hisobi va desktop robot ulanishi."
        actions={<Button icon={<Save size={15} />} loading={saving} onClick={save}>Saqlash</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Cpu size={14} /> Ijrochi rejimi</p>
            <p className="mt-0.5 text-[11.5px] text-muted">Yangi run’lar shu rejimda boshlanadi.</p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setRunnerMode(mode.id)}
                  className={cx(
                    'rounded-xl border p-3.5 text-left transition-colors',
                    runnerMode === mode.id ? 'border-primary/50 bg-primary-soft/50 ring-1 ring-primary/20' : 'border-border hover:border-slate-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', runnerMode === mode.id ? 'bg-primary text-white' : 'bg-slate-100 text-muted')}>
                      <mode.icon size={15} />
                    </span>
                    {runnerMode === mode.id ? <CheckCircle2 size={16} className="text-primary" /> : null}
                  </div>
                  <p className="mt-2 text-[13px] font-semibold">{mode.title}</p>
                  <Badge tone={mode.id === 'desktop' ? 'success' : 'info'} className="mt-1">{mode.badge}</Badge>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">{mode.description}</p>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Monitor size={14} /> Vaqt hisobi</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
              <Field label="Qo‘lda bajarish" hint="daqiqa / ferma">
                <Input type="number" min={1} max={240} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} className="tabular" />
              </Field>
              <div className="rounded-lg bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-muted">
                Boshqaruvdagi “tejalgan vaqt” shu qiymat asosida hisoblanadi. Masalan, {minutes} daq × 90 ferma ={' '}
                <span className="font-medium text-foreground">{(minutes * 90 / 60).toFixed(1)} soat</span> bitta oylik oqim uchun.
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold"><ShieldAlert size={14} /> Ishonchlilik</p>
            <p className="mt-0.5 text-[11.5px] text-muted">Xato yoki qo‘l harakati bo‘lganda robot qanday to‘xtaydi.</p>
            <div className="mt-3 space-y-3">
              <label className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <input
                  type="checkbox"
                  checked={stopOnError}
                  onChange={(event) => setStopOnError(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary/30"
                />
                <span>
                  <span className="block text-[12.5px] font-medium">Xatoda butun runni to‘xtatish</span>
                  <span className="block text-[11px] leading-relaxed text-muted">
                    BR-07: bitta fermada natija mos kelmasa, butun partiya pauza qilinadi va buxgalter tekshiradi. O‘chirilgan bo‘lsa,
                    faqat shu ferma to‘xtab, keyingisiga o‘tiladi.
                  </span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Field label="Fermalar orasidagi pauza" hint="soniya">
                  <Input
                    type="number"
                    min={0}
                    max={600}
                    value={farmWait}
                    onChange={(event) => setFarmWait(Math.max(0, Number(event.target.value) || 0))}
                    className="tabular"
                  />
                </Field>
                <div className="rounded-lg bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-muted">
                  FR-27: fermalar ketma-ket bajariladi; har biridan keyin shu qadar kutish platformani ortiqcha yuklamaydi.
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-semibold"><KeyRound size={14} /> Desktop robot tokeni</p>
                <p className="mt-0.5 text-[11.5px] text-muted">180 kunlik token — desktop ilova shu kalit bilan navbatdan job oladi.</p>
              </div>
              <Button size="sm" variant="secondary" loading={tokenBusy} onClick={loadToken}>Tokenni ko‘rsatish</Button>
            </div>
            {token ? (
              <div className="mt-2.5">
                <div className="flex items-start gap-2 rounded-lg border border-border bg-slate-50 p-2.5">
                  <code className="flex-1 break-all font-mono text-[11px] leading-relaxed">{token}</code>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copyToken}><Copy size={13} /></Button>
                </div>
                <p className="mt-1.5 text-[10.5px] text-subtle">Tokenni faqat o‘zingizning kompyuteringizdagi desktop ilovaga kiriting. U serverdagi vault kalitini ochmaydi.</p>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Tizim</p>
            <dl className="mt-2.5 space-y-2 text-[12px]">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Versiya</dt>
                <dd className="font-mono">v{settings.data?.version}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Joriy rejim</dt>
                <dd><Badge tone={settings.data?.runnerMode === 'desktop' ? 'success' : 'info'}>{settings.data?.runnerMode === 'desktop' ? 'Desktop' : 'Simulyatsiya'}</Badge></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Javobgarlik</dt>
                <dd className="text-right text-[11px]">{settings.data?.accountabilityAcceptedAt ? formatDateTime(settings.data.accountabilityAcceptedAt) : '—'}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 p-2.5 text-[10.5px] leading-relaxed text-subtle">
              <Database size={12} className="mt-0.5 shrink-0" />
              <span className="break-all font-mono">{settings.data?.dataDir}</span>
            </div>
          </Card>

          <Card className="p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><ShieldCheck size={13} /> Xavfsizlik</p>
            <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted">
              <li>• Master parol scrypt bilan hash’lanadi — ochiq saqlanmaydi.</li>
              <li>• .pfx, parollar va ERI paroli AES-256-GCM bilan shifrlanadi.</li>
              <li>• 30 daqiqa harakatsizlikda sessiya avtomatik qulflanadi.</li>
              <li>• Ilova hech qachon hujjatni imzolamaydi yoki yubormaydi.</li>
            </ul>
          </Card>

          <div className="rounded-xl border border-border bg-surface p-4 text-[11px] leading-relaxed text-muted shadow-card">
            <p className="font-medium text-foreground">Desktop robotni ishga tushirish</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4">
              <li>Terminalda: <code className="font-mono text-[10.5px]">npm run dev:desktop</code></li>
              <li>Server manzilini kiriting (masalan, <code className="font-mono text-[10.5px]">http://localhost:3100</code>).</li>
              <li>Yuqoridagi tokenni joylashtiring va ulang.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
