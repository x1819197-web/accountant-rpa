import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Gauge, ListFilter, Play, Plus, Search, ShieldAlert, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cx, formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import type { Dataset, DatasetCoverage, Farm, RunSummary, RunView, Scenario } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  KeyBadge,
  Modal,
  PageHeader,
  PageLoader,
  PlatformBadge,
  Progress,
  RunStatusBadge,
  Select,
  TableWrap,
  Td,
  Th,
} from '@/components/ui';

export function RunsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (params.get('new')) setOpen(true);
  }, [params]);

  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.get<{ runs: RunSummary[] }>('/runs?limit=50'),
    refetchInterval: 4_000,
  });

  const close = () => {
    setOpen(false);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const list = runs.data?.runs ?? [];
  const active = list.filter((run) => run.status === 'running' || run.status === 'awaiting_approval');

  return (
    <div>
      <PageHeader
        title="Runlar"
        description="Har run — tanlangan fermalarda bitta scenariyoning ketma-ket ijrosi. Har qadam jurnalga yoziladi."
        actions={<Button icon={<Plus size={15} />} onClick={() => setOpen(true)}>Yangi run</Button>}
      />

      {active.length ? (
        <div className="mb-4 space-y-2">
          {active.map((run) => (
            <Card key={run.id} className="flex flex-wrap items-center justify-between gap-3 border-primary/25 bg-primary-soft/40 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                  {run.status === 'awaiting_approval' ? <AlertTriangle size={15} /> : <Zap size={15} />}
                </span>
                <div>
                  <p className="text-[13px] font-semibold">{run.scenarioName}</p>
                  <p className="text-[11.5px] text-muted">
                    {run.status === 'awaiting_approval'
                      ? 'Tasdiq kutilmoqda — live run boshlanishidan oldin ko‘rib chiqing.'
                      : `${run.doneCount + run.errorCount + run.skippedCount}/${run.totalFarms} ferma bajarildi`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RunStatusBadge status={run.status} />
                <Button size="sm" variant="secondary" icon={<ArrowRight size={13} />} onClick={() => navigate(`/runs/${run.id}`)}>
                  Ochish
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        {runs.isPending ? (
          <PageLoader />
        ) : list.length === 0 ? (
          <EmptyState
            title="Hali run yo‘q"
            description="Birinchi runni yarating: scenariyni tanlang, fermalarni belgilang va dry run qiling."
            icon={<Play size={18} />}
            action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen(true)}>Run yaratish</Button>}
          />
        ) : (
          <TableWrap>
            <thead className="border-b border-line bg-slate-50/60">
              <tr>
                <Th>Scenario</Th>
                <Th>Rejim</Th>
                <Th>Fermalar</Th>
                <Th>Holat</Th>
                <Th className="text-right">Davomiylik</Th>
                <Th>Boshlangan</Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {list.map((run) => {
                const processed = run.doneCount + run.errorCount + run.skippedCount;
                return (
                  <tr
                    key={run.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/70"
                    onClick={() => navigate(`/runs/${run.id}`)}
                  >
                    <Td>
                      <p className="font-medium">{run.scenarioName}</p>
                      <p className="text-[11px] text-subtle">v{run.scenarioVersion} · {run.stepsCount} qadam · {run.runner === 'desktop' ? 'desktop' : 'simulyatsiya'}</p>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        <Badge tone={run.mode === 'dry' ? 'neutral' : 'primary'}>{run.mode === 'dry' ? 'Dry run' : 'Live'}</Badge>
                        {run.hasIrreversible ? <span className="inline-flex items-center gap-0.5 text-[10px] text-warn"><ShieldAlert size={9} /> imzo</span> : null}
                      </div>
                    </Td>
                    <Td className="min-w-36">
                      <div className="flex items-center gap-2">
                        <span className="w-12 shrink-0 tabular text-[12px] text-muted">{processed}/{run.totalFarms}</span>
                        <Progress value={run.progress} className="flex-1" tone={run.errorCount ? 'danger' : 'primary'} />
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-subtle">
                        {run.doneCount} bajarildi · {run.errorCount} xato · {run.skippedCount} o‘tkazildi
                      </p>
                    </Td>
                    <Td><RunStatusBadge status={run.status} /></Td>
                    <Td className="text-right tabular text-[12px] text-muted">{run.startedAt ? formatDuration(run.elapsedSeconds) : '—'}</Td>
                    <Td className="text-[12px] text-muted">
                      {run.startedAt ? formatDateTime(run.startedAt) : relativeTime(run.createdAt)}
                    </Td>
                    <Td className="text-right"><ArrowRight size={14} className="text-subtle" /></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <NewRunModal
        open={open}
        onClose={close}
        scenarioPreset={params.get('scenario')}
        onCreated={(runId) => {
          close();
          void runs.refetch();
          navigate(`/runs/${runId}`);
        }}
      />
    </div>
  );
}

function NewRunModal({
  open,
  onClose,
  scenarioPreset,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  scenarioPreset: string | null;
  onCreated: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [scenarioId, setScenarioId] = useState('');
  const [mode, setMode] = useState<'dry' | 'live'>('dry');
  const [datasetId, setDatasetId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const scenarios = useQuery({
    queryKey: ['scenarios', 'active', 'run'],
    queryFn: () => api.get<{ scenarios: Scenario[] }>('/scenarios?search='),
    enabled: open,
  });
  const farms = useQuery({
    queryKey: ['farms', 'active', 'run'],
    queryFn: () => api.get<{ farms: Farm[] }>('/farms?status=active'),
    enabled: open,
  });
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.get<{ datasets: Dataset[] }>('/datasets'),
    enabled: open,
  });
  const coverage = useQuery({
    queryKey: ['dataset-coverage', datasetId],
    queryFn: () => api.get<{ dataset: Dataset; coverage: DatasetCoverage[] }>(`/datasets/${datasetId}`),
    enabled: open && Boolean(datasetId),
  });

  useEffect(() => {
    if (!open) return;
    const activeScenarios = scenarios.data?.scenarios.filter((scenario) => scenario.status === 'active') ?? [];
    setScenarioId((current) => current || scenarioPreset || activeScenarios[0]?.id || '');
    setMode('dry');
    setSelected(new Set());
    setSearch('');
    if (datasets.data?.datasets[0]) setDatasetId(datasets.data.datasets[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scenarios.data, datasets.data]);

  const scenario = scenarios.data?.scenarios.find((item) => item.id === scenarioId);
  const activeFarms = farms.data?.farms ?? [];
  const filtered = activeFarms.filter(
    (farm) => !search || farm.name.toLowerCase().includes(search.toLowerCase()) || farm.tin.includes(search),
  );
  const missingMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of coverage.data?.coverage ?? []) map.set(item.tin, item.missing);
    return map;
  }, [coverage.data]);
  const selectedFarms = activeFarms.filter((farm) => selected.has(farm.id));
  const withMissing = selectedFarms.filter((farm) => (missingMap.get(farm.tin) ?? []).length > 0);
  const skippedKeys = selectedFarms.filter((farm) => farm.key.status === 'expired' || farm.key.status === 'missing');
  const groups = [...new Set(activeFarms.map((farm) => farm.groupName).filter(Boolean))] as string[];

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: string) => {
    const ids = activeFarms.filter((farm) => farm.groupName === group).map((farm) => farm.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const submit = async () => {
    if (!scenarioId) {
      toast.error('Scenariyni tanlang.');
      return;
    }
    if (selected.size === 0) {
      toast.error('Kamida bitta fermani belgilang.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<RunView>('/runs', {
        scenarioId,
        farmIds: [...selected],
        mode,
        datasetId: datasetId || null,
      });
      toast.success(mode === 'dry' ? 'Dry run boshlandi.' : 'Live run yaratildi.');
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
      void queryClient.invalidateQueries({ queryKey: ['metrics'] });
      setSelected(new Set());
      onCreated(result.run.id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yangi run"
      description="Scenario, rejim va fermalarni tanlang. Muammoli fermalar sababi bilan o‘tkazib yuboriladi."
      width="xl"
      footer={
        <>
          <div className="mr-auto text-[11.5px] text-muted">
            {selected.size} ferma tanlandi
            {withMissing.length ? ` · ${withMissing.length} da qiymat to‘liq emas` : ''}
            {skippedKeys.length ? ` · ${skippedKeys.length} kaliti muammoli` : ''}
          </div>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button loading={busy} onClick={submit} icon={mode === 'dry' ? <Gauge size={15} /> : <Play size={15} />}>
            {mode === 'dry' ? 'Dry run boshlash' : 'Live run yaratish'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_1fr]">
          <Field label="Scenario" required>
            <Select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>
              <option value="">Tanlang…</option>
              {(scenarios.data?.scenarios ?? []).filter((item) => item.status === 'active').map((item) => (
                <option key={item.id} value={item.id}>{item.name} (v{item.version})</option>
              ))}
            </Select>
          </Field>
          <Field label="Rejim">
            <Select value={mode} onChange={(event) => setMode(event.target.value as 'dry' | 'live')}>
              <option value="dry">Dry run</option>
              <option value="live">Live</option>
            </Select>
          </Field>
          <Field label="Ma’lumotlar to‘plami" hint="ixtiyoriy">
            <Select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
              <option value="">Dataset’siz</option>
              {(datasets.data?.datasets ?? []).map((dataset) => (
                <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {scenario ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-muted">
            <PlatformBadge platform={scenario.platform} />
            <span>{scenario.stepsCount} qadam</span>
            <span>·</span>
            <span>v{scenario.version}</span>
            {scenario.hasIrreversible ? <Badge tone="warn"><ShieldAlert size={10} /> live run tasdiq talab qiladi</Badge> : null}
          </div>
        ) : null}

        {mode === 'live' ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-[11.5px] leading-relaxed text-warn">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            Live run — haqiqiy amallar. BR-04: bu versiya avval bitta fermada muvaffaqiyatli dry run qilmagan bo‘lsa,
            server runni rad etadi. Imzolash baribir buxgalter tasdig‘isiz bajarilmaydi.
          </div>
        ) : null}

        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium">Fermalar <span className="text-subtle">({activeFarms.length} faol)</span></span>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(activeFarms.map((farm) => farm.id)))}>Barchasi</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Tozalash</Button>
            </div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-44 flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ferma yoki STIR…" className="h-8.5 pl-8 text-[12px]" />
            </div>
            {groups.slice(0, 5).map((group) => (
              <button
                key={group}
                onClick={() => toggleGroup(group)}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted hover:border-primary/40 hover:text-primary"
              >
                {group}
              </button>
            ))}
          </div>
          <div className="scroll-thin max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full">
              <tbody>
                {filtered.map((farm) => {
                  const missing = missingMap.get(farm.tin) ?? [];
                  return (
                    <tr
                      key={farm.id}
                      onClick={() => toggle(farm.id)}
                      className={cx('cursor-pointer border-b border-line last:border-0 hover:bg-slate-50', selected.has(farm.id) && 'bg-primary-soft/40')}
                    >
                      <td className="w-8 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selected.has(farm.id)}
                          onChange={() => toggle(farm.id)}
                          onClick={(event) => event.stopPropagation()}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary/30"
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <p className="text-[12.5px] font-medium">{farm.name}</p>
                        <p className="font-mono text-[10.5px] text-subtle">{farm.tin} · {farm.groupName ?? 'guruhsiz'}</p>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {farm.key.status !== 'ok' ? <KeyBadge status={farm.key.status} daysLeft={farm.key.daysLeft} /> : null}
                          {missing.length ? (
                            <Badge tone="warn"><AlertTriangle size={10} /> {missing.length} qiymat yo‘q</Badge>
                          ) : datasetId ? (
                            <CheckCircle2 size={13} className="text-success/70" />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 ? <p className="px-3 py-4 text-center text-[12px] text-muted">Ferma topilmadi.</p> : null}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-subtle">
            <ListFilter size={11} /> Kaliti yo‘q/muddati o‘tgan yoki qiymati yetishmagan fermalar run’da “o‘tkazib yuborildi” bo‘ladi — xato yozilmaydi.
          </p>
        </div>
      </div>
    </Modal>
  );
}
