import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Archive, Copy, Layers, ListChecks, Pencil, Plus, RotateCcw, Search, ShieldAlert, TestTube2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import type { Platform, Scenario } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  PlatformBadge,
  Select,
  Textarea,
  platformLabels,
} from '@/components/ui';

export function ScenariosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editScenario, setEditScenario] = useState<Scenario | null>(null);

  const list = useQuery({
    queryKey: ['scenarios', search, platform],
    queryFn: () => api.get<{ scenarios: Scenario[] }>(`/scenarios?search=${encodeURIComponent(search)}&platform=${platform}`),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    void queryClient.invalidateQueries({ queryKey: ['metrics'] });
  };

  const action = async (scenario: Scenario, path: 'copy' | 'archive' | 'restore') => {
    try {
      const result = await api.post<{ scenario?: Scenario }>(`/scenarios/${scenario.id}/${path}`);
      if (path === 'copy' && result.scenario) {
        toast.success('Nusxa yaratildi.');
        refresh();
        navigate(`/scenarios/${result.scenario.id}`);
        return;
      }
      toast.success(path === 'archive' ? 'Scenario arxivlandi.' : 'Scenario tiklandi.');
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (scenario: Scenario) => {
    if (!window.confirm(`«${scenario.name}» butunlay o‘chirilsinmi? Run tarixi bo‘lsa, arxivlashni taklif qilamiz.`)) return;
    try {
      await api.del(`/scenarios/${scenario.id}`);
      toast.success('Scenario o‘chirildi.');
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="Scenariylar"
        description="Har bir ish — qadamlar ketma-ketligi. Yozib oling, tahrirlang va fermalarga qo‘llang. Yangi versiya sinovdan o‘tmaguncha live run boshlanmaydi."
        actions={<Button icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>Yangi scenario</Button>}
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-52 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Scenario nomi…" className="pl-8" />
        </div>
        <Select value={platform} onChange={(event) => setPlatform(event.target.value)} className="w-44">
          <option value="">Barcha platformalar</option>
          {(Object.keys(platformLabels) as Platform[]).map((item) => (
            <option key={item} value={item}>{platformLabels[item]}</option>
          ))}
        </Select>
        {list.data ? <span className="px-1 text-[12px] text-subtle">{list.data.scenarios.length} ta scenario</span> : null}
      </Card>

      {list.isPending ? (
        <PageLoader />
      ) : list.data?.scenarios.length === 0 ? (
        <Card>
          <EmptyState
            title="Scenario topilmadi"
            description="Birinchi scenariyani yarating: platforma tanlang, qadamlar qo‘shing yoki yozib oling."
            icon={<ListChecks size={18} />}
            action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Yangi scenario</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data?.scenarios.map((scenario) => (
            <Card key={scenario.id} className="group flex flex-col p-4 transition-colors hover:border-slate-300">
              <button className="text-left" onClick={() => navigate(`/scenarios/${scenario.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Layers size={15} />
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    <PlatformBadge platform={scenario.platform} />
                    {scenario.status === 'archived' ? <Badge>Arxiv</Badge> : null}
                  </div>
                </div>
                <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug">{scenario.name}</h3>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">{scenario.description || 'Tavsif yo‘q'}</p>
              </button>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="neutral">v{scenario.version}</Badge>
                <Badge tone="neutral">{scenario.stepsCount} qadam</Badge>
                {scenario.folder ? <Badge tone="neutral">{scenario.folder}</Badge> : null}
                {scenario.hasIrreversible ? <Badge tone="warn"><ShieldAlert size={11} /> Tasdiq talab qiladi</Badge> : null}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                <span className="text-[11px] text-subtle">{relativeTime(scenario.updatedAt)}</span>
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" title="Dry run" onClick={() => navigate(`/runs?new=1&scenario=${scenario.id}`)}>
                    <TestTube2 size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" title="Nomini o‘zgartirish" onClick={() => setEditScenario(scenario)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" title="Nusxalash" onClick={() => action(scenario, 'copy')}>
                    <Copy size={14} />
                  </Button>
                  {scenario.status === 'active' ? (
                    <Button size="icon" variant="ghost" title="Arxivlash" onClick={() => action(scenario, 'archive')}>
                      <Archive size={14} />
                    </Button>
                  ) : (
                    <Button size="icon" variant="ghost" title="Tiklash" onClick={() => action(scenario, 'restore')}>
                      <RotateCcw size={14} />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" title="O‘chirish" className="hover:text-danger" onClick={() => remove(scenario)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateScenarioModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); refresh(); navigate(`/scenarios/${id}`); }} />
      <EditScenarioModal scenario={editScenario} onClose={() => setEditScenario(null)} onSaved={() => { setEditScenario(null); refresh(); }} />
    </div>
  );
}

function EditScenarioModal({ scenario, onClose, onSaved }: { scenario: Scenario | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', folder: '', description: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (scenario) setForm({ name: scenario.name, folder: scenario.folder ?? '', description: scenario.description ?? '' });
  }, [scenario]);

  if (!scenario) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/scenarios/${scenario.id}`, { name: form.name, folder: form.folder, description: form.description });
      toast.success('Scenario yangilandi.');
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Scenarioni tahrirlash"
      description="Nom, papka va tavsif o‘zgaradi — qadamlar va versiyalar tegilmaydi."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button form="edit-scenario" type="submit" loading={busy}>Saqlash</Button>
        </>
      }
    >
      <form id="edit-scenario" onSubmit={submit} className="space-y-3">
        <Field label="Nomi" required>
          <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Papka">
          <Input value={form.folder} onChange={(event) => setForm({ ...form, folder: event.target.value })} placeholder="Didox" />
        </Field>
        <Field label="Tavsif">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}

function CreateScenarioModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ name: '', platform: 'didox' as Platform, folder: '', description: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ scenario: Scenario }>('/scenarios', {
        name: form.name,
        platform: form.platform,
        folder: form.folder || undefined,
        description: form.description || undefined,
        steps: [],
        variables: [],
      });
      toast.success('Scenario yaratildi. Endi qadamlar qo‘shing.');
      onCreated(result.scenario.id);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const create = useMutation({ mutationFn: submit });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yangi scenario"
      description="Platformani tanlang — qadamlar keyingi ekranda qo‘shiladi."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button form="create-scenario" type="submit" loading={busy || create.isPending}>Yaratish</Button>
        </>
      }
    >
      <form id="create-scenario" onSubmit={submit} className="space-y-3">
        <Field label="Nomi" required>
          <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan: Didox — oylik faktura qoralamasi" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Platforma" required>
            <Select value={form.platform} onChange={(event) => setForm({ ...form, platform: event.target.value as Platform })}>
              {(Object.keys(platformLabels) as Platform[]).map((item) => (
                <option key={item} value={item}>{platformLabels[item]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Papka">
            <Input value={form.folder} onChange={(event) => setForm({ ...form, folder: event.target.value })} placeholder="Didox" />
          </Field>
        </div>
        <Field label="Tavsif">
          <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}
