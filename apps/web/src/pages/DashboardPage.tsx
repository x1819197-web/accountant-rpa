import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  KeyRound,
  Play,
  Plus,
  ShieldAlert,
  Sprout,
  Timer,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cx, formatDateTime, formatDuration, formatNumber, relativeTime } from '@/lib/format';
import type { Metrics } from '@/lib/types';
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader, PlatformBadge, Progress, RunStatusBadge, TableWrap, Td, Th } from '@/components/ui';

export function DashboardPage() {
  const navigate = useNavigate();
  const metrics = useQuery({ queryKey: ['metrics'], queryFn: () => api.get<Metrics>('/metrics'), refetchInterval: 3_000 });

  if (metrics.isPending) return <PageLoader />;
  if (metrics.isError || !metrics.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-danger-soft p-6 text-sm text-danger">
        Ko‘rsatkichlarni yuklab bo‘lmadi.
      </div>
    );
  }

  const m = metrics.data;
  const active = m.activeRun;
  const maxBar = Math.max(1, ...m.series.map((day) => day.done + day.error));
  const savedHours = m.timeSaved.savedMinutes / 60;
  const keyAlerts = m.keys.alerts.slice(0, 4);

  const kpis = [
    {
      label: 'Faol fermalar',
      value: formatNumber(m.farms.active),
      hint: `${m.farms.withKey} ta kalit biriktirilgan · ${m.farms.missingKey} ta yo‘q`,
      icon: Sprout,
      tone: 'text-primary bg-primary-soft',
      onClick: () => navigate('/farms'),
    },
    {
      label: 'Bugungi runlar',
      value: formatNumber(m.runsToday),
      hint: m.runningRuns ? `${m.runningRuns} ta hozir ishlamoqda` : 'Hozir ijro yo‘q',
      icon: Play,
      tone: 'text-info bg-info-soft',
      onClick: () => navigate('/runs'),
    },
    {
      label: 'Muvaffaqiyat — 30 kun',
      value: `${m.last30.successRate}%`,
      hint: `${formatNumber(m.last30.done)} bajarildi · ${formatNumber(m.last30.errors)} xato · ${formatNumber(m.last30.skipped)} o‘tkazildi`,
      icon: CheckCircle2,
      tone: 'text-success bg-success-soft',
      onClick: () => navigate('/reports'),
    },
    {
      label: 'Tejalgan vaqt',
      value: savedHours >= 1 ? `${savedHours.toFixed(1)} soat` : `${m.timeSaved.savedMinutes} daq`,
      hint: `Qo‘lda: ${m.timeSaved.actualMinutes} daq · ${m.timeSaved.manualMinutesPerFarm} daq/ferma`,
      icon: Timer,
      tone: 'text-warn bg-warn-soft',
      onClick: () => navigate('/settings'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Boshqaruv"
        description="Barcha fermalar, ishlar va keyingi qadamlar bir joyda. Ko‘rsatkichlar real vaqtda yangilanadi."
        actions={
          <>
            <Button variant="secondary" icon={<Sprout size={15} />} onClick={() => navigate('/farms')}>
              Fermalar
            </Button>
            <Button icon={<Plus size={15} />} onClick={() => navigate('/runs?new=1')}>
              Yangi run
            </Button>
          </>
        }
      />

      {active ? (
        <Card className="mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-primary-soft/60 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                <Bot size={16} />
              </span>
              <div>
                <p className="text-[13px] font-semibold">Hozir ishlamoqda — {active.scenarioName}</p>
                <p className="text-[11.5px] text-muted">
                  {active.done + active.errors}/{active.total} ferma · {active.errors ? `${active.errors} xato` : 'xatosiz'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <RunStatusBadge status={active.status} />
              <Button size="sm" variant="secondary" icon={<ArrowUpRight size={14} />} onClick={() => navigate(`/runs/${active.id}`)}>
                Run markazi
              </Button>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-muted">
              <span>Jarayon</span>
              <span className="tabular font-medium text-foreground">{active.progress}%</span>
            </div>
            <Progress value={active.progress} />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <button
            key={kpi.label}
            onClick={kpi.onClick}
            className="group rounded-xl border border-border bg-surface p-4 text-left shadow-card transition-colors hover:border-slate-300"
          >
            <div className="flex items-start justify-between">
              <span className="text-[12px] font-medium text-muted">{kpi.label}</span>
              <span className={cx('flex h-7 w-7 items-center justify-center rounded-lg', kpi.tone)}>
                <kpi.icon size={14.5} />
              </span>
            </div>
            <p className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight tabular">{kpi.value}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-subtle">{kpi.hint}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">Oxirgi 7 kun</p>
                <p className="text-[11.5px] text-subtle">Har kun bajarilgan fermalar va xatolar</p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-success" /> Bajarildi</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-danger" /> Xato</span>
              </div>
            </div>
            <div className="flex h-36 items-end gap-2 px-4 py-4">
              {m.series.map((day) => {
                const total = day.done + day.error;
                const height = total ? Math.max(6, Math.round((total / maxBar) * 92)) : 2;
                return (
                  <div key={day.date} className="group flex flex-1 flex-col items-center justify-end gap-1.5" title={`${day.date}: ${day.done} bajarildi, ${day.error} xato`}>
                    <span className={cx('text-[10px] tabular', total ? 'text-muted' : 'text-transparent')}>{total}</span>
                    <div className="flex w-full max-w-9 flex-col justify-end overflow-hidden rounded-md bg-slate-100" style={{ height }}>
                      {day.error > 0 ? (
                        <div className="w-full bg-danger" style={{ height: `${(day.error / Math.max(1, total)) * 100}%` }} />
                      ) : null}
                      <div className="w-full bg-success" style={{ flex: 1 }} />
                    </div>
                    <span className="text-[10.5px] text-subtle">{day.date.slice(8, 10)}.{day.date.slice(5, 7)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-[13px] font-semibold">So‘nggi runlar</p>
              <button onClick={() => navigate('/runs')} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                Barchasi <ArrowUpRight size={13} />
              </button>
            </div>
            {m.recentRuns.length === 0 ? (
              <EmptyState
                title="Hali run yo‘q"
                description="Birinchi runni yarating: scenario tanlang, fermalarni belgilang va dry run qilib ko‘ring."
                action={<Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/runs?new=1')}>Run yaratish</Button>}
              />
            ) : (
              <TableWrap>
                <thead className="border-b border-line bg-slate-50/60">
                  <tr>
                    <Th>Scenario</Th>
                    <Th>Rejim</Th>
                    <Th className="text-right">Fermalar</Th>
                    <Th>Holat</Th>
                    <Th className="text-right">Vaqt</Th>
                  </tr>
                </thead>
                <tbody>
                  {m.recentRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/70"
                      onClick={() => navigate(`/runs/${run.id}`)}
                    >
                      <Td className="max-w-56 truncate font-medium">{run.scenarioName}</Td>
                      <Td>
                        <Badge tone={run.mode === 'dry' ? 'neutral' : 'primary'}>{run.mode === 'dry' ? 'Dry run' : 'Live'}</Badge>
                      </Td>
                      <Td className="text-right tabular text-muted">
                        {run.doneCount + run.errorCount + run.skippedCount}/{run.totalFarms}
                      </Td>
                      <Td><RunStatusBadge status={run.status} /></Td>
                      <Td className="text-right text-[12px] text-subtle">{relativeTime(run.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-[13px] font-semibold">Kalitlar — e’tibor bering</p>
              <button onClick={() => navigate('/farms')} className="text-[12px] font-medium text-primary hover:underline">Fermalar</button>
            </div>
            {keyAlerts.length === 0 ? (
              <div className="flex items-center gap-2.5 px-4 py-5 text-[12.5px] text-muted">
                <CheckCircle2 size={16} className="text-success" /> Barcha kalitlar amalda.
              </div>
            ) : (
              <div className="divide-y divide-line">
                {keyAlerts.map((alert) => (
                  <div key={alert.tin} className="flex items-start gap-2.5 px-4 py-3">
                    <span className={cx('mt-0.5 flex h-6 w-6 items-center justify-center rounded-md', alert.daysLeft < 0 ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn')}>
                      {alert.daysLeft < 0 ? <ShieldAlert size={13} /> : <KeyRound size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{alert.farmName}</p>
                      <p className="font-mono text-[11px] text-subtle">{alert.tin}</p>
                    </div>
                    <Badge tone={alert.daysLeft < 0 ? 'danger' : 'warn'}>
                      {alert.daysLeft < 0 ? `${Math.abs(alert.daysLeft)} kun o‘tdi` : `${alert.daysLeft} kun`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-[13px] font-semibold">30 kunlik sifat</p>
            <div className="mt-3 space-y-3.5">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11.5px]">
                  <span className="text-muted">Muvaffaqiyat</span>
                  <span className="tabular font-medium">{m.last30.successRate}%</span>
                </div>
                <Progress value={m.last30.successRate} tone="success" />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11.5px]">
                  <span className="text-muted">Qo‘l tegmasdan bajarilgan</span>
                  <span className="tabular font-medium">{m.last30.unattendedRate}%</span>
                </div>
                <Progress value={m.last30.unattendedRate} />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <p className="flex items-center gap-1 text-[10.5px] text-subtle"><Clock3 size={11} /> O‘rtacha ferma</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular">{formatDuration(m.last30.avgFarmSeconds)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5">
                  <p className="flex items-center gap-1 text-[10.5px] text-subtle"><AlertTriangle size={11} /> Qo‘l aralashuvi</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular">{formatNumber(m.last30.manualInterventions)}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-[13px] font-semibold">Platformalar</p>
              <Badge tone={m.runnerMode === 'desktop' ? 'success' : 'info'}>{m.runnerMode === 'desktop' ? 'Desktop robot' : 'Simulyatsiya'}</Badge>
            </div>
            <div className="divide-y divide-line">
              {m.platforms.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-muted">Hali platforma bo‘yicha run yo‘q.</p>
              ) : (
                m.platforms.map((item) => (
                  <div key={item.platform} className="flex items-center justify-between px-4 py-2.5">
                    <PlatformBadge platform={item.platform} />
                    <div className="flex items-center gap-3 text-[11.5px] text-muted">
                      <span className="inline-flex items-center gap-1"><Sprout size={11} /> {item.farms}</span>
                      <span className="inline-flex items-center gap-1"><Zap size={11} /> {item.runs} run</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <div className="rounded-xl border border-border bg-surface p-4 text-[11.5px] text-muted shadow-card">
            <p className="flex items-center gap-1.5 font-medium text-foreground"><CalendarClock size={13} /> Hisobot tayyor</p>
            <p className="mt-1 leading-relaxed">Oxirgi 30 kun bo‘yicha Excel hisobotni yuklab oling — har ferma va qiymatlar bilan.</p>
            <Button variant="soft" size="sm" className="mt-2.5" icon={<FileSpreadsheet size={14} />} onClick={() => navigate('/reports')}>
              Hisobotga o‘tish
            </Button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-right text-[11px] text-subtle">Oxirgi yangilanish: {formatDateTime(new Date().toISOString())}</p>
    </div>
  );
}
