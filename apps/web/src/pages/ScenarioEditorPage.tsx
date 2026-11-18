import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  FileSpreadsheet,
  Gauge,
  GitBranch,
  History,
  KeyRound,
  ListChecks,
  MousePointerClick,
  Play,
  Plus,
  Repeat2,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  Variable as VariableIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cx, formatDateTime, relativeTime } from '@/lib/format';
import type { Dataset, Farm, Platform, RunView, ScenarioDetail, Step, Variable } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  PageLoader,
  PlatformBadge,
  Select,
  Textarea,
  platformLabels,
} from '@/components/ui';

const stepTypes = [
  'navigate', 'click', 'fill', 'extract', 'wait', 'check', 'eimzo-login', 'password-login', 'sign', 'manual', 'loop', 'condition',
] as const;

type StepType = (typeof stepTypes)[number];

const stepLabels: Record<StepType, string> = {
  navigate: 'Sahifa ochish',
  click: 'Bosish',
  sign: 'Imzolash',
  fill: 'Maydon to‘ldirish',
  extract: 'Qiymat olish',
  wait: 'Kutish',
  check: 'Tekshirish',
  'eimzo-login': 'E-IMZO bilan kirish',
  'password-login': 'Parol bilan kirish',
  manual: 'Qo‘l harakati',
  loop: 'Takrorlash',
  condition: 'Shart',
};

const stepDescriptions: Record<StepType, string> = {
  navigate: 'URL manzilga o‘tish',
  click: 'Elementni bosish',
  sign: 'Imzolash — faqat qoralama emas',
  fill: 'Maydonga qiymat yoki o‘zgaruvchi yozish',
  extract: 'Sahifadan qiymat o‘qib, o‘zgaruvchiga yozish',
  wait: 'Kutish yoki element paydo bo‘lishini kutish',
  check: 'Matn yoki element mavjudligini tekshirish',
  'eimzo-login': 'E-IMZO kaliti bilan avtomatik kirish',
  'password-login': 'Saqlangan login/parol bilan kirish',
  manual: 'Buxgalterdan tasdiq yoki qo‘l harakati',
  loop: 'Ro‘yxat elementlari bo‘ylab takrorlash',
  condition: 'Shartga qarab tarmoqlanish',
};

const systemOptions = [
  { key: 'farm.name', label: 'Ferma nomi' },
  { key: 'farm.tin', label: 'Ferma STIR' },
  { key: 'date', label: 'Joriy sana (dd.mm.yyyy)' },
  { key: 'period', label: 'Davr (YYYY-MM)' },
] as const;

function newStep(type: StepType, platform: string): Step {
  const base = { id: crypto.randomUUID(), description: stepDescriptions[type] };
  switch (type) {
    case 'navigate':
      return { ...base, type, url: '' };
    case 'click':
      return { ...base, type, selector: '', irreversible: false };
    case 'sign':
      return { ...base, type, selector: '' };
    case 'fill':
      return { ...base, type, selector: '', value: '' };
    case 'extract':
      return { ...base, type, selector: '', variable: '', attribute: 'text' };
    case 'wait':
      return { ...base, type, ms: 1000 };
    case 'check':
      return { ...base, type, text: '' };
    case 'eimzo-login':
      return { ...base, type, platform };
    case 'password-login':
      return { ...base, type, platform };
    case 'manual':
      return { ...base, type, reason: '' };
    case 'loop':
      return { ...base, type, selector: '', steps: [] };
    case 'condition':
      return { ...base, type, selector: '', then: [], otherwise: [] };
  }
}

function countAll(steps: Step[]): number {
  return steps.reduce((sum, step) => {
    if (step.type === 'loop') return sum + 1 + countAll(step.steps);
    if (step.type === 'condition') return sum + 1 + countAll(step.then) + countAll(step.otherwise);
    return sum + 1;
  }, 0);
}

export function ScenarioEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [steps, setSteps] = useState<Step[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  const detail = useQuery({
    queryKey: ['scenario', id],
    queryFn: () => api.get<ScenarioDetail>(`/scenarios/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!detail.data) return;
    if (loadedVersion === detail.data.scenario.version) return;
    setSteps(detail.data.steps);
    setVariables(detail.data.variables);
    setLoadedVersion(detail.data.scenario.version);
    setDirty(false);
  }, [detail.data, loadedVersion]);

  const totalSteps = useMemo(() => countAll(steps), [steps]);

  const variableOptions = useMemo(() => {
    const names = new Set(variables.map((variable) => variable.name));
    const visit = (list: Step[]) => {
      for (const step of list) {
        if (step.type === 'extract' && step.variable && !names.has(step.variable)) names.add(step.variable);
        if (step.type === 'loop') visit(step.steps);
        if (step.type === 'condition') {
          visit(step.then);
          visit(step.otherwise);
        }
      }
    };
    visit(steps);
    return [
      ...variables,
      ...[...names]
        .filter((name) => !variables.some((variable) => variable.name === name))
        .map<Variable>((name) => ({ name, label: name, source: 'constant', value: '' })),
    ];
  }, [steps, variables]);

  const apply = (nextSteps: Step[], nextVariables = variables) => {
    setSteps(nextSteps);
    setVariables(nextVariables);
    setDirty(true);
  };

  const save = async (note?: string) => {
    setSaving(true);
    try {
      await api.put(`/scenarios/${id}`, { steps, variables, note: note || undefined });
      toast.success('Yangi versiya saqlandi. Live run uchun avval dry run qiling (BR-04).');
      setDirty(false);
      setShowNote(false);
      setVersionNote('');
      setLoadedVersion(null);
      await queryClient.invalidateQueries({ queryKey: ['scenario', id] });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const rollback = async (version: number) => {
    if (!window.confirm(`v${version} holatiga qaytarilsinmi? Yangi versiya yaratiladi.`)) return;
    try {
      await api.post(`/scenarios/${id}/rollback`, { version });
      toast.success(`v${version} dan yangi versiya yaratildi.`);
      setLoadedVersion(null);
      await queryClient.invalidateQueries({ queryKey: ['scenario', id] });
      await queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (detail.isPending) return <PageLoader />;
  if (detail.isError || !detail.data) {
    return <div className="rounded-xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">{errorMessage(detail.error)}</div>;
  }

  const scenario = detail.data.scenario;

  return (
    <div>
      <Link to="/scenarios" className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-foreground">
        <ArrowLeft size={13} /> Scenariylar
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{scenario.name}</h1>
            <PlatformBadge platform={scenario.platform} />
            <Badge tone="neutral">v{scenario.version}</Badge>
            {scenario.status === 'archived' ? <Badge>Arxivlangan</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {scenario.description || 'Tavsif yo‘q'} · {totalSteps} qadam · {variables.length} o‘zgaruvchi · {relativeTime(scenario.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Play size={15} />} onClick={() => setTestOpen(true)}>
            Dry run
          </Button>
          <Button
            variant={dirty ? 'primary' : 'secondary'}
            icon={<Save size={15} />}
            disabled={!dirty}
            loading={saving}
            onClick={() => (versionNote ? void save(versionNote) : setShowNote(true))}
          >
            {dirty ? 'Yangi versiya saqlash' : 'Saqlangan'}
          </Button>
        </div>
      </div>

      {dirty ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-warn-soft px-3 py-2 text-[12px] text-warn">
          <CircleAlert size={14} /> Saqlanmagan o‘zgarishlar bor. Saqlash yangi versiya yaratadi.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-semibold"><ListChecks size={14} /> Qadamlar</p>
                <p className="text-[11.5px] text-subtle">Har qadam fermada bir marta bajariladi; {`{{o‘zgaruvchi}}`} ferma qiymatlari bilan almashtiriladi.</p>
              </div>
              <Badge tone="neutral">{totalSteps}</Badge>
            </div>
            <div className="space-y-2.5 p-3">
              {steps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center">
                  <Sparkles size={18} className="mx-auto text-subtle" />
                  <p className="mt-1.5 text-[13px] font-medium">Hali qadam yo‘q</p>
                  <p className="mt-0.5 text-[12px] text-muted">Quyidagi tugma bilan birinchi qadamni qo‘shing.</p>
                </div>
              ) : (
                <StepList
                  steps={steps}
                  platform={scenario.platform}
                  variables={variableOptions}
                  onChange={(next) => apply(next)}
                  depth={0}
                />
              )}
              <AddStep platform={scenario.platform} onAdd={(type) => apply([...steps, newStep(type, scenario.platform)])} />
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-semibold"><VariableIcon size={14} /> O‘zgaruvchilar</p>
                <p className="text-[11.5px] text-subtle">Ferma bo‘yicha farq qiladigan qiymatlar. Excel to‘plamidan yoki tizimdan olinadi.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={13} />}
                onClick={() => {
                  const name = `var${variables.length + 1}`;
                  apply(steps, [...variables, { name, label: name, source: 'constant', value: '' }]);
                }}
              >
                Qo‘shish
              </Button>
            </div>
            <div className="space-y-2 p-3">
              {variables.length === 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2.5 text-[11.5px] text-muted">
                  Tez qo‘shish:
                  {systemOptions.map((option) => (
                    <button
                      key={option.key}
                      onClick={() =>
                        apply(steps, [
                          ...variables,
                          { name: option.key.replace('.', '_'), label: option.label, source: 'system', systemKey: option.key },
                        ])
                      }
                      className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-medium text-primary hover:bg-primary-soft"
                    >
                      + {option.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {variables.map((variable, index) => (
                <div key={`${variable.name}-${index}`} className="rounded-lg border border-border p-2.5">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Nomi" hint="kodda ishlatiladi">
                      <Input
                        value={variable.name}
                        className="h-8.5 font-mono text-[12px]"
                        onChange={(event) => {
                          const next = [...variables];
                          next[index] = { ...variable, name: event.target.value.replace(/\s/g, '_') };
                          apply(steps, next);
                        }}
                      />
                    </Field>
                    <Field label="Yorliq" hint="UI’da ko‘rinadi">
                      <Input
                        value={variable.label}
                        className="h-8.5"
                        onChange={(event) => {
                          const next = [...variables];
                          next[index] = { ...variable, label: event.target.value };
                          apply(steps, next);
                        }}
                      />
                    </Field>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[150px_1fr_auto]">
                    <Field label="Manba">
                      <Select
                        value={variable.source}
                        className="h-8.5"
                        onChange={(event) => {
                          const source = event.target.value as Variable['source'];
                          const next = [...variables];
                          next[index] = { ...variable, source, systemKey: undefined, value: '' };
                          apply(steps, next);
                        }}
                      >
                        <option value="system">Tizim</option>
                        <option value="dataset">Excel to‘plam</option>
                        <option value="constant">Doimiy</option>
                      </Select>
                    </Field>
                    {variable.source === 'system' ? (
                      <Field label="Tizim qiymati">
                        <Select
                          value={variable.systemKey ?? ''}
                          className="h-8.5"
                          onChange={(event) => {
                            const next = [...variables];
                            next[index] = { ...variable, systemKey: event.target.value as Variable['systemKey'] };
                            apply(steps, next);
                          }}
                        >
                          <option value="">Tanlang…</option>
                          {systemOptions.map((option) => (
                            <option key={option.key} value={option.key}>{option.label}</option>
                          ))}
                        </Select>
                      </Field>
                    ) : variable.source === 'dataset' ? (
                      <Field label="Ustun nomi" hint="Excel sarlavhasi">
                        <Input
                          value={variable.value ?? ''}
                          className="h-8.5 font-mono text-[12px]"
                          placeholder={variable.name}
                          onChange={(event) => {
                            const next = [...variables];
                            next[index] = { ...variable, value: event.target.value };
                            apply(steps, next);
                          }}
                        />
                      </Field>
                    ) : (
                      <Field label="Qiymat">
                        <Input
                          value={variable.value ?? ''}
                          className="h-8.5"
                          onChange={(event) => {
                            const next = [...variables];
                            next[index] = { ...variable, value: event.target.value };
                            apply(steps, next);
                          }}
                        />
                      </Field>
                    )}
                    <div className="flex items-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="O‘chirish"
                        onClick={() => apply(steps, variables.filter((_, position) => position !== index))}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-[12.5px] font-semibold uppercase tracking-wide text-muted">Ma’lumot</p>
            <dl className="mt-2.5 space-y-2 text-[12px]">
              <div className="flex justify-between gap-2"><dt className="text-muted">Platforma</dt><dd><PlatformBadge platform={scenario.platform} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Papka</dt><dd className="font-medium">{scenario.folder ?? '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Versiya</dt><dd className="font-mono font-medium">v{scenario.version}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Qadamlar</dt><dd className="tabular font-medium">{totalSteps}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Yaratilgan</dt><dd className="font-medium">{formatDateTime(scenario.createdAt)}</dd></div>
            </dl>
            {scenario.hasIrreversible ? (
              <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-warn-soft p-2.5 text-[11px] leading-relaxed text-warn">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                Scenariyda imzolash/qaytarib bo‘lmaydigan qadam bor. Live run har doim tasdiq so‘raydi (BR-03).
              </div>
            ) : null}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><History size={13} /> Versiyalar</p>
              <Badge tone="neutral">{detail.data.versions.length}</Badge>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto p-2">
              {detail.data.versions.map((version) => (
                <div key={version.version} className={cx('rounded-lg px-2 py-1.5', version.version === scenario.version ? 'bg-primary-soft' : 'hover:bg-slate-50')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cx('font-mono text-[11.5px] font-medium', version.version === scenario.version ? 'text-primary' : 'text-muted')}>
                      v{version.version}
                    </span>
                    {version.version !== scenario.version ? (
                      <button onClick={() => rollback(version.version)} className="text-[10.5px] font-medium text-primary hover:underline">
                        Qaytarish
                      </button>
                    ) : (
                      <Badge tone="primary">joriy</Badge>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-subtle">{version.note ?? 'Izohsiz'} · {formatDateTime(version.createdAt)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4 text-[11.5px] leading-relaxed text-muted">
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-foreground"><Eye size={13} /> Eslatma</p>
            <p className="mt-1">Dry run hech narsa yaratmaydi yoki imzolamaydi. Live run avval bitta fermada muvaffaqiyatli dry run talab qiladi.</p>
          </Card>
        </div>
      </div>

      <TestRunModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        scenarioId={id}
        platform={scenario.platform}
      />

      <Modal
        open={showNote}
        onClose={() => setShowNote(false)}
        title="Versiya izohi"
        description="O‘zgarishning qisqa sababi — keyinchalik versiyalar tarixida ko‘rinadi."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowNote(false)}>Bekor qilish</Button>
            <Button loading={saving} onClick={() => void save(versionNote)}>Saqlash</Button>
          </>
        }
      >
        <Field label="Izoh" hint="ixtiyoriy">
          <Input autoFocus value={versionNote} onChange={(event) => setVersionNote(event.target.value)} placeholder="Masalan: Didox sahifasi yangilandi" />
        </Field>
      </Modal>
    </div>
  );
}

function StepList({
  steps,
  platform,
  variables,
  onChange,
  depth,
}: {
  steps: Step[];
  platform: Platform;
  variables: Variable[];
  onChange: (next: Step[]) => void;
  depth: number;
}) {
  const replace = (id: string, next: Step) => onChange(steps.map((step) => (step.id === id ? next : step)));
  const remove = (id: string) => onChange(steps.filter((step) => step.id !== id));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    onChange(next);
  };

  return (
    <div className={cx('space-y-2', depth > 0 && 'border-l-2 border-slate-100 pl-3')}>
      {steps.map((step, index) => (
        <StepCard
          key={step.id}
          step={step}
          index={index}
          count={steps.length}
          platform={platform}
          variables={variables}
          depth={depth}
          onReplace={(next) => replace(step.id, next)}
          onRemove={() => remove(step.id)}
          onMove={(direction) => move(index, direction)}
        />
      ))}
      <AddStep platform={platform} onAdd={(type) => onChange([...steps, newStep(type, platform)])} />
    </div>
  );
}

function StepCard({
  step,
  index,
  count,
  platform,
  variables,
  depth,
  onReplace,
  onRemove,
  onMove,
}: {
  step: Step;
  index: number;
  count: number;
  platform: Platform;
  variables: Variable[];
  depth: number;
  onReplace: (next: Step) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const patch = (values: Record<string, unknown>) => onReplace({ ...step, ...values } as Step);
  const danger = step.type === 'sign' || (step.type === 'click' && step.irreversible);

  return (
    <div className={cx('rounded-lg border bg-surface p-3', danger ? 'border-amber-200' : 'border-border')}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold tabular text-muted">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={danger ? 'warn' : step.type === 'eimzo-login' ? 'primary' : 'neutral'}>
              {stepLabels[step.type]}
            </Badge>
            {danger ? <Badge tone="warn"><ShieldAlert size={10} /> Tasdiq</Badge> : null}
            {step.enabled === false ? <Badge>O‘chirilgan</Badge> : null}
          </div>
          <Input
            value={step.description}
            onChange={(event) => patch({ description: event.target.value })}
            className="mt-1.5 h-8 border-transparent bg-transparent px-1 text-[12.5px] font-medium hover:border-border focus:border-primary/40"
            placeholder="Qadam izohi"
          />
          <div className="mt-1.5 space-y-2">
            {step.type === 'navigate' ? (
              <Field label="URL">
                <Input value={step.url} onChange={(event) => patch({ url: event.target.value })} className="h-8.5 font-mono text-[12px]" placeholder="https://didox.uz/…" />
              </Field>
            ) : null}

            {step.type === 'click' || step.type === 'sign' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Selektor">
                  <Input value={step.selector} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" placeholder="button.save" />
                </Field>
                {step.type === 'click' ? (
                  <Field label="Kutilgan matn" hint="ixtiyoriy">
                    <Input value={step.expectedText ?? ''} onChange={(event) => patch({ expectedText: event.target.value })} className="h-8.5" />
                  </Field>
                ) : (
                  <div className="flex items-end pb-1 text-[11px] leading-snug text-warn">
                    Imzolash — qaytarib bo‘lmaydigan qadam. Live run tasdiq so‘raydi.
                  </div>
                )}
              </div>
            ) : null}

            {step.type === 'click' ? (
              <label className="flex items-center gap-2 text-[11.5px] text-muted">
                <input
                  type="checkbox"
                  checked={Boolean(step.irreversible)}
                  onChange={(event) => patch({ irreversible: event.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary/30"
                />
                Qaytarib bo‘lmaydigan amal (masalan, yuborish)
              </label>
            ) : null}

            {step.type === 'fill' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Selektor">
                  <Input value={step.selector} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" placeholder="input[name=summa]" />
                </Field>
                <Field label="O‘zgaruvchi" hint="yoki doimiy qiymat">
                  <Select
                    value={step.variable ?? ''}
                    onChange={(event) => patch({ variable: event.target.value || undefined })}
                    className="h-8.5"
                  >
                    <option value="">— doimiy —</option>
                    {variables.map((variable) => (
                      <option key={variable.name} value={variable.name}>{variable.name}</option>
                    ))}
                  </Select>
                </Field>
                {step.variable ? (
                  <Field label="Maxfiy manba" hint="ixtiyoriy">
                    <Select value={step.secret ?? ''} onChange={(event) => patch({ secret: event.target.value || undefined })} className="h-8.5">
                      <option value="">— oddiy —</option>
                      <option value="login">login</option>
                      <option value="password">parol</option>
                      <option value="eri">ERI paroli</option>
                    </Select>
                  </Field>
                ) : (
                  <Field label="Qiymat">
                    <Input value={step.value} onChange={(event) => patch({ value: event.target.value })} className="h-8.5" />
                  </Field>
                )}
              </div>
            ) : null}

            {step.type === 'extract' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Selektor">
                  <Input value={step.selector} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" placeholder=".doc-number" />
                </Field>
                <Field label="O‘zgaruvchi nomi" hint="keyingi qadamlarda {{nom}}">
                  <Input value={step.variable} onChange={(event) => patch({ variable: event.target.value })} className="h-8.5 font-mono text-[12px]" placeholder="hujjat_raqami" />
                </Field>
                <Field label="Qiymat turi">
                  <Select value={step.attribute ?? 'text'} onChange={(event) => patch({ attribute: event.target.value })} className="h-8.5">
                    <option value="text">Matn</option>
                    <option value="value">Maydon qiymati</option>
                    <option value="href">Havola (href)</option>
                  </Select>
                </Field>
              </div>
            ) : null}

            {step.type === 'wait' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Kutish (ms)">
                  <Input type="number" value={step.ms ?? 1000} onChange={(event) => patch({ ms: Number(event.target.value) })} className="h-8.5 tabular" />
                </Field>
                <Field label="Yoki selektor paydo bo‘lishi">
                  <Input value={step.selector ?? ''} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" />
                </Field>
              </div>
            ) : null}

            {step.type === 'check' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Selektor" hint="ixtiyoriy">
                  <Input value={step.selector ?? ''} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" />
                </Field>
                <Field label="Kutilgan matn">
                  <Input value={step.text ?? ''} onChange={(event) => patch({ text: event.target.value })} className="h-8.5" />
                </Field>
              </div>
            ) : null}

            {step.type === 'eimzo-login' || step.type === 'password-login' ? (
              <Field label="Platforma">
                <Select value={step.platform} onChange={(event) => patch({ platform: event.target.value })} className="h-8.5 sm:w-56">
                  {(Object.keys(platformLabels) as Platform[]).map((item) => (
                    <option key={item} value={item}>{platformLabels[item]}</option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {step.type === 'manual' ? (
              <Field label="Sabab / ko‘rsatma">
                <Input value={step.reason ?? ''} onChange={(event) => patch({ reason: event.target.value })} className="h-8.5" placeholder="Masalan: SMS kodni kiriting" />
              </Field>
            ) : null}

            {step.type === 'loop' ? (
              <>
                <Field label="Ro‘yxat selektori">
                  <Input value={step.selector} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" />
                </Field>
                <div className="rounded-lg bg-slate-50/70 p-2">
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
                    <Repeat2 size={11} /> Takrorlanadigan qadamlar ({step.steps.length})
                  </p>
                  <StepList
                    steps={step.steps}
                    platform={platform}
                    variables={variables}
                    depth={depth + 1}
                    onChange={(next) => patch({ steps: next })}
                  />
                </div>
              </>
            ) : null}

            {step.type === 'condition' ? (
              <>
                <Field label="Shart selektori">
                  <Input value={step.selector} onChange={(event) => patch({ selector: event.target.value })} className="h-8.5 font-mono text-[12px]" />
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50/70 p-2">
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted"><GitBranch size={11} /> Bo‘lsa</p>
                    <StepList steps={step.then} platform={platform} variables={variables} depth={depth + 1} onChange={(next) => patch({ then: next })} />
                  </div>
                  <div className="rounded-lg bg-slate-50/70 p-2">
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted"><GitBranch size={11} /> Aks holda</p>
                    <StepList steps={step.otherwise} platform={platform} variables={variables} depth={depth + 1} onChange={(next) => patch({ otherwise: next })} />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-0.5">
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Yuqoriga" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={12.5} />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" title="Pastga" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown size={12.5} />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted hover:text-danger" title="O‘chirish" onClick={onRemove}>
            <Trash2 size={12.5} />
          </Button>
        </div>
      </div>

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-1.5 pl-8 text-[11px] text-subtle">
        <input
          type="checkbox"
          checked={step.enabled !== false}
          onChange={(event) => patch({ enabled: event.target.checked })}
          className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary/30"
        />
        Faol
      </label>
    </div>
  );
}

function AddStep({ platform, onAdd }: { platform: Platform; onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] font-medium text-muted transition-colors hover:border-primary/40 hover:text-primary"
      >
        <Plus size={13} /> Qadam qo‘shish
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-slate-50/60 p-2 anim-fade">
      <div className="grid gap-1.5 sm:grid-cols-3">
        {stepTypes.map((type) => (
          <button
            key={type}
            onClick={() => {
              onAdd(type);
              setOpen(false);
            }}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-left text-[11.5px] hover:border-primary/40 hover:text-primary"
          >
            {type === 'click' ? <MousePointerClick size={12} /> : type === 'wait' ? <Clock3 size={12} /> : type === 'eimzo-login' || type === 'password-login' ? <KeyRound size={12} /> : type === 'condition' ? <GitBranch size={12} /> : <ChevronRight size={12} />}
            <span className="truncate">{stepLabels[type]}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-[10.5px] text-subtle">Platforma: {platformLabels[platform]}. Imzolash qadami live run’da tasdiq talab qiladi.</p>
    </div>
  );
}

function TestRunModal({ open, onClose, scenarioId, platform }: { open: boolean; onClose: () => void; scenarioId: string; platform: Platform }) {
  const navigate = useNavigate();
  const [farmId, setFarmId] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [busy, setBusy] = useState(false);

  const farms = useQuery({
    queryKey: ['farms', 'active', 'test'],
    queryFn: () => api.get<{ farms: Farm[] }>('/farms?status=active'),
    enabled: open,
  });
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api.get<{ datasets: Dataset[] }>('/datasets'),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const first = farms.data?.farms[0];
    if (!farmId && first) setFarmId(first.id);
    const latest = datasets.data?.datasets[0];
    setDatasetId((current) => current || (latest ? latest.id : ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, farms.data, datasets.data]);

  const submit = async () => {
    if (!farmId) {
      toast.error('Fermani tanlang.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<RunView>('/runs', {
        scenarioId,
        farmIds: [farmId],
        mode: 'dry',
        datasetId: datasetId || null,
      });
      toast.success('Dry run boshlandi.');
      onClose();
      navigate(`/runs/${result.run.id}`);
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
      title="Dry run — bitta fermada sinov"
      description="Hech narsa yaratilmaydi. Natija live run uchun ruxsat beradi (BR-04)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button loading={busy} onClick={submit} icon={<Gauge size={15} />}>Sinovni boshlash</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Ferma" required>
          <Select value={farmId} onChange={(event) => setFarmId(event.target.value)}>
            <option value="">Tanlang…</option>
            {(farms.data?.farms ?? []).map((farm) => (
              <option key={farm.id} value={farm.id}>{farm.name} — {farm.tin}</option>
            ))}
          </Select>
        </Field>
        <Field label="Ma’lumotlar to‘plami" hint="o‘zgaruvchilar uchun">
          <Select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
            <option value="">Dataset’siz</option>
            {(datasets.data?.datasets ?? []).map((dataset) => (
              <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.rowsCount} qator</option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg bg-slate-50 p-2.5 text-[11.5px] leading-relaxed text-muted">
          Platforma: <span className="font-medium text-foreground">{platformLabels[platform]}</span>. Dry run ham fermaning kaliti,
          parollari va qiymatlarini tekshiradi — muammo bo‘lsa ferma sababi bilan o‘tkazib yuboriladi.
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-subtle"><FileSpreadsheet size={12} /> Dataset ustunlari o‘zgaruvchilar nomiga mos bo‘lishi kerak.</p>
      </div>
    </Modal>
  );
}

