import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, DEMO_MODE, downloadFile, errorMessage } from '@/lib/api';
import { cx, formatDateTime, formatDuration, formatTime } from '@/lib/format';
import type { RunEvent, RunFarm, RunView } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FarmStatusBadge,
  Modal,
  PageLoader,
  PlatformBadge,
  Progress,
  RunStatusBadge,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';

const activeStatuses = new Set(['running', 'awaiting_approval', 'paused']);

export function RunDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [farmFilter, setFarmFilter] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{ farm: RunFarm } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const runQuery = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.get<RunView>(`/runs/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const data = query.state.data as RunView | undefined;
      return data && activeStatuses.has(data.run.status) ? 2_000 : false;
    },
  });

  const live = runQuery.data ? activeStatuses.has(runQuery.data.run.status) : false;
  const events = useRunEvents(id, live);

  const act = async (path: string, label: string) => {
    setBusy(path);
    try {
      const next = await api.post<RunView>(`/runs/${id}/${path}`);
      queryClient.setQueryData(['run', id], next);
      toast.success(label);
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['metrics'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const exportExcel = async () => {
    try {
      await downloadFile(`/reports/runs/${id}/export.xlsx`, `run-${id.slice(0, 8)}.xlsx`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (runQuery.isPending) return <PageLoader />;
  if (runQuery.isError || !runQuery.data) {
    return <div className="rounded-xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">{errorMessage(runQuery.error)}</div>;
  }

  const { run, farms, review } = runQuery.data;
  const processed = run.doneCount + run.errorCount + run.skippedCount;
  const filteredEvents = farmFilter ? events.filter((event) => event.runFarmId === farmFilter) : events;
  const failed = farms.filter((farm) => farm.status === 'error').length;

  return (
    <div>
      <Link to="/runs" className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-foreground">
        <ArrowLeft size={13} /> Runlar
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[21px] font-semibold tracking-tight">{run.scenarioName}</h1>
            <RunStatusBadge status={run.status} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            <Badge tone={run.mode === 'dry' ? 'neutral' : 'primary'}>{run.mode === 'dry' ? 'Dry run' : 'Live run'}</Badge>
            <span>v{run.scenarioVersion}</span>
            <span>·</span>
            <span>{run.totalFarms} ferma</span>
            <span>·</span>
            <span>{run.runner === 'desktop' ? 'Desktop robot' : 'Simulyatsiya'}</span>
            <span>·</span>
            <span className="font-mono text-[11px]">{run.id.slice(0, 8)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.status === 'awaiting_approval' ? (
            <>
              <Button variant="secondary" icon={<Square size={14} />} loading={busy === 'cancel'} onClick={() => act('cancel', 'Run bekor qilindi.')}>
                Bekor qilish
              </Button>
              <Button icon={<Check size={15} />} loading={busy === 'approve'} onClick={() => act('approve', 'Tasdiqlandi. Ijro boshlandi.')}>
                Tasdiqlash va boshlash
              </Button>
            </>
          ) : null}
          {run.status === 'running' ? (
            <Button variant="secondary" icon={<Pause size={14} />} loading={busy === 'pause'} onClick={() => act('pause', 'Run to‘xtatildi.')}>
              To‘xtatish
            </Button>
          ) : null}
          {run.status === 'paused' ? (
            <>
              <Button variant="secondary" icon={<Square size={14} />} loading={busy === 'cancel'} onClick={() => act('cancel', 'Run bekor qilindi.')}>
                Bekor qilish
              </Button>
              <Button icon={<Play size={14} />} loading={busy === 'resume'} onClick={() => act('resume', 'Run davom ettirildi.')}>
                Davom ettirish
              </Button>
            </>
          ) : null}
          {failed > 0 && run.status !== 'running' ? (
            <Button variant="secondary" icon={<RotateCcw size={14} />} loading={busy === 'retry-failed'} onClick={() => act('retry-failed', `${failed} ferma qayta navbatga qo‘yildi.`)}>
              Xatolarni qayta
            </Button>
          ) : null}
          <Button variant="secondary" icon={<Download size={14} />} onClick={exportExcel}>
            Excel
          </Button>
        </div>
      </div>

      {run.mode === 'dry' ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-sky-200 bg-info-soft px-3 py-2 text-[12px] leading-relaxed text-info">
          <Gauge size={14} className="mt-0.5 shrink-0" />
          Dry run: hech narsa yaratilmaydi, imzolanmaydi. Imzolash qadamlari o‘tkazib yuboriladi.
        </div>
      ) : null}

      {run.status === 'awaiting_approval' ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-warn-soft p-4">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warn text-white">
              <ShieldAlert size={15} />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-warn">Tasdiq kutilmoqda (BR-03)</p>
              <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-warn/90">
                Bu live run va tarkibida imzolash yoki qaytarib bo‘lmaydigan qadam bor. Quyidagi jadvaldagi qiymatlarni
                tekshiring. Tasdiqlaganingizdan keyin ilova ishlaydi, lekin hujjatni imzolamaydi va yubormaydi.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
                <Badge tone="warn">{run.hasIrreversible ? 'Imzolash qadami bor' : 'Tasdiq talab qilinadi'}</Badge>
                <Badge tone="neutral">{run.totalFarms} ferma</Badge>
                <Badge tone="neutral">{run.stepsCount} qadam</Badge>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {run.message ? (
        <div className="mb-4 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-muted">{run.message}</div>
      ) : null}

      <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-3.5">
          <p className="text-[11.5px] text-muted">Jarayon</p>
          <div className="mt-1 flex items-end justify-between">
            <p className="text-[20px] font-semibold tabular">{run.progress}%</p>
            <p className="text-[11.5px] text-subtle">{processed}/{run.totalFarms}</p>
          </div>
          <Progress value={run.progress} className="mt-2" tone={run.errorCount ? 'danger' : 'primary'} />
        </Card>
        <Card className="p-3.5">
          <p className="flex items-center gap-1 text-[11.5px] text-muted"><CheckCircle2 size={12} className="text-success" /> Bajarildi</p>
          <p className="mt-1 text-[20px] font-semibold tabular text-success">{run.doneCount}</p>
          <p className="mt-1 text-[11px] text-subtle">Xatosiz tugagan fermalar</p>
        </Card>
        <Card className="p-3.5">
          <p className="flex items-center gap-1 text-[11.5px] text-muted"><XCircle size={12} className="text-danger" /> Xato</p>
          <p className="mt-1 text-[20px] font-semibold tabular text-danger">{run.errorCount}</p>
          <p className="mt-1 text-[11px] text-subtle">Qayta urinish mumkin</p>
        </Card>
        <Card className="p-3.5">
          <p className="flex items-center gap-1 text-[11.5px] text-muted"><Clock3 size={12} className="text-warn" /> O‘tkazildi</p>
          <p className="mt-1 text-[20px] font-semibold tabular text-warn">{run.skippedCount}</p>
          <p className="mt-1 text-[11px] text-subtle">Sababi jadvalda</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">Fermalar</p>
                <p className="text-[11.5px] text-subtle">Har ferma holati va aniq qiymatlar</p>
              </div>
              {farmFilter ? (
                <button onClick={() => setFarmFilter(null)} className="text-[11.5px] font-medium text-primary hover:underline">
                  Filtrni tozalash
                </button>
              ) : null}
            </div>
            {farms.length === 0 ? (
              <EmptyState title="Fermalar yo‘q" />
            ) : (
              <TableWrap>
                <thead className="border-b border-line bg-slate-50/60">
                  <tr>
                    <Th className="w-6">#</Th>
                    <Th>Ferma</Th>
                    <Th>Holat</Th>
                    <Th>Urinish</Th>
                    <Th>Screenshot</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {farms.map((farm, index) => {
                    const farmReview = review.find((item) => item.runFarmId === farm.id);
                    return (
                      <tr
                        key={farm.id}
                        onClick={() => setFarmFilter(farmFilter === farm.id ? null : farm.id)}
                        className={cx(
                          'cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/70',
                          farmFilter === farm.id && 'bg-primary-soft/40',
                        )}
                      >
                        <Td className="text-[11.5px] text-subtle">{index + 1}</Td>
                        <Td>
                          <p className="font-medium">{farm.name}</p>
                          <p className="font-mono text-[10.5px] text-subtle">{farm.tin}</p>
                          {farmReview && farmReview.missing.length ? (
                            <p className="mt-0.5 text-[10.5px] text-danger">Yetishmaydi: {farmReview.missing.join(', ')}</p>
                          ) : null}
                          {farm.errorMessage ? (
                            <p className="mt-0.5 text-[10.5px] text-danger">
                              {farm.errorCode ? `${farm.errorCode}: ` : ''}{farm.errorMessage}
                            </p>
                          ) : null}
                        </Td>
                        <Td>
                          <div className="flex flex-col items-start gap-1">
                            <FarmStatusBadge status={farm.status} />
                            {farm.startedAt && farm.finishedAt ? (
                              <span className="text-[10px] text-subtle">
                                {formatDuration(Math.round((new Date(farm.finishedAt).getTime() - new Date(farm.startedAt).getTime()) / 1000))}
                              </span>
                            ) : null}
                          </div>
                        </Td>
                        <Td className="tabular text-[12px] text-muted">{farm.attempt}</Td>
                        <Td>
                          {farm.screenshot ? (
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setScreenshot({ farm });
                              }}
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
                            >
                              <Camera size={12} /> Ko‘rish
                            </button>
                          ) : (
                            <span className="text-[11.5px] text-subtle">—</span>
                          )}
                        </Td>
                        <Td className="text-right"><ChevronRight size={13} className={cx('transition-transform', farmFilter === farm.id && 'rotate-180 text-primary')} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="text-[13px] font-semibold">Tekshiruv — qiymatlar</p>
                <p className="text-[11.5px] text-subtle">Har fermada qanday qiymatlar ishlatiladi (BR-03 ko‘rigi)</p>
              </div>
            </div>
            <TableWrap>
              <thead className="border-b border-line bg-slate-50/60">
                <tr>
                  <Th>Ferma</Th>
                  <Th>Qiymatlar</Th>
                </tr>
              </thead>
              <tbody>
                {review.map((item) => {
                  const farm = farms.find((entry) => entry.id === item.runFarmId);
                  return (
                    <tr key={item.runFarmId} className="border-b border-line last:border-0 align-top">
                      <Td className="max-w-44">
                        <p className="truncate font-medium">{farm?.name ?? '—'}</p>
                        <p className="font-mono text-[10.5px] text-subtle">{farm?.tin}</p>
                      </Td>
                      <Td>
                        {Object.keys(item.values).length === 0 ? (
                          <span className="text-[11.5px] text-subtle">O‘zgaruvchi yo‘q</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(item.values).map(([key, value]) => (
                              <span key={key} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px]">
                                <span className="text-subtle">{key}:</span>
                                <span className="text-foreground">{value}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {item.missing.length ? (
                          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-danger"><AlertTriangle size={10} /> {item.missing.join(', ')}</p>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
        </div>

        <Card className="flex max-h-[720px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Terminal size={14} /> Jonli jurnal</p>
              <p className="text-[11.5px] text-subtle">
                {farmFilter ? farms.find((farm) => farm.id === farmFilter)?.name ?? 'Ferma' : 'Barcha fermalar'} · {filteredEvents.length} yozuv
              </p>
            </div>
            <span className={cx('flex items-center gap-1 text-[10.5px]', live ? 'text-success' : 'text-subtle')}>
              <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'bg-success pulse-dot' : 'bg-slate-300')} />
              {live ? 'stream' : 'tugagan'}
            </span>
          </div>
          <div ref={logRef} className="scroll-thin flex-1 overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-muted">Yozuvlar yo‘q.</div>
            ) : (
              <div className="divide-y divide-line">
                {filteredEvents
                  .slice()
                  .reverse()
                  .map((event) => (
                    <div key={event.id} className="flex items-start gap-2 px-3.5 py-2">
                      <span className="mt-0.5 font-mono text-[10px] tabular text-subtle">{formatTime(event.ts)}</span>
                      <EventDot type={event.type} />
                      <div className="min-w-0">
                        <p className="text-[11.5px] leading-snug text-foreground/90">{event.message ?? event.type}</p>
                        <p className="text-[9.5px] uppercase tracking-wide text-subtle">{event.type}</p>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="border-t border-line bg-slate-50/60 px-3.5 py-2 text-[10.5px] text-subtle">
            Yaratilgan {formatDateTime(run.createdAt)}
            {run.startedAt ? ` · Boshlangan ${formatDateTime(run.startedAt)}` : ''}
            {run.finishedAt ? ` · Tugagan ${formatDateTime(run.finishedAt)}` : ''}
          </div>
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        <PlatformBadge platform="didox" />
        <span>Run davomiyligi: {run.startedAt ? formatDuration(run.elapsedSeconds) : '—'}</span>
        {run.approvedAt ? <Badge tone="success">Tasdiqlangan: {formatDateTime(run.approvedAt)}</Badge> : null}
        {run.hasIrreversible ? <Badge tone="warn"><ShieldAlert size={10} /> imzolash qadami bor</Badge> : null}
      </div>

      <ScreenshotModal runId={id} farm={screenshot?.farm ?? null} onClose={() => setScreenshot(null)} />
    </div>
  );
}

function EventDot({ type }: { type: string }) {
  const map: Record<string, string> = {
    farm_done: 'bg-success',
    run_completed: 'bg-success',
    farm_error: 'bg-danger',
    run_failed: 'bg-danger',
    farm_skipped: 'bg-warn',
    run_awaiting_approval: 'bg-warn',
    farm_started: 'bg-info',
    run_started: 'bg-info',
    manual_required: 'bg-warn',
  };
  return <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', map[type] ?? 'bg-slate-300')} />;
}

function ScreenshotModal({ runId, farm, onClose }: { runId: string; farm: RunFarm | null; onClose: () => void }) {
  return (
    <Modal
      open={Boolean(farm)}
      onClose={onClose}
      title={`Screenshot — ${farm?.name ?? ''}`}
      description={farm?.errorMessage ?? 'Ijro paytida olingan ekran'}
      width="xl"
    >
      {farm ? (
        <img
          src={`/api/runs/${runId}/farms/${farm.id}/screenshot`}
          alt={`${farm.name} screenshot`}
          className="max-h-[60vh] w-full rounded-lg border border-border object-contain"
        />
      ) : null}
    </Modal>
  );
}

function useRunEvents(runId: string, live: boolean): RunEvent[] {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    seen.current = new Set();
    setEvents([]);
    if (!runId) return;
    let cancelled = false;
    api
      .get<{ events: RunEvent[] }>(`/runs/${runId}/events?after=0`)
      .then((result) => {
        if (cancelled) return;
        const initial = result.events;
        seen.current = new Set(initial.map((event) => event.id));
        setEvents(initial);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!live || !runId) return;
    if (DEMO_MODE) {
      let cancelled = false;
      const pull = async () => {
        try {
          const result = await api.get<{ events: RunEvent[] }>(`/runs/${runId}/events?after=0`);
          if (cancelled) return;
          const fresh = result.events.filter((event) => !seen.current.has(event.id));
          if (!fresh.length) return;
          for (const event of fresh) seen.current.add(event.id);
          setEvents(result.events.slice(-500));
          if (fresh.some((event) => event.type.startsWith('farm_') || event.type.startsWith('run_'))) {
            void queryClient.invalidateQueries({ queryKey: ['run', runId] });
          }
        } catch {
          // ignore transient failures
        }
      };
      const timer = window.setInterval(pull, 900);
      void pull();
      return () => {
        cancelled = true;
        window.clearInterval(timer);
      };
    }
    const source = new EventSource(`/api/runs/${runId}/stream`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RunEvent;
        if (seen.current.has(event.id)) return;
        seen.current.add(event.id);
        setEvents((previous) => [...previous, event].slice(-500));
        if (event.type.startsWith('farm_') || event.type.startsWith('run_')) {
          void queryClient.invalidateQueries({ queryKey: ['run', runId] });
        }
      } catch {
        // ignore malformed frames
      }
    };
    source.onerror = () => {
      source.close();
    };
    return () => source.close();
  }, [runId, live, queryClient]);

  return events;
}

