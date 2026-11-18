import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronRight,
  Download,
  FileUp,
  KeyRound,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sprout,
  Trash2,
  Upload,
  UserCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { cx, formatDate, formatDateTime } from '@/lib/format';
import type { Farm, Platform } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  KeyBadge,
  Modal,
  PageHeader,
  PageLoader,
  PlatformBadge,
  Select,
  TableWrap,
  Td,
  Textarea,
  Th,
  platformLabels,
} from '@/components/ui';

type FarmList = { farms: Farm[]; groups: string[] };

export function FarmsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [group, setGroup] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({
    queryKey: ['farms', search, status, group],
    queryFn: () => api.get<FarmList>(`/farms?search=${encodeURIComponent(search)}&status=${status}&group=${encodeURIComponent(group)}`),
  });

  const detail = useQuery({
    queryKey: ['farm', selectedId],
    queryFn: () => api.get<{ farm: Farm }>(`/farms/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['farms'] });
    void queryClient.invalidateQueries({ queryKey: ['farm'] });
    void queryClient.invalidateQueries({ queryKey: ['metrics'] });
    void queryClient.invalidateQueries({ queryKey: ['datasets'] });
  };

  return (
    <div>
      <PageHeader
        title="Fermalar"
        description="Har bir fermer xo‘jaligi: rekvizitlar, E-IMZO kaliti va platforma kirishlari."
        actions={
          <>
            <Button variant="secondary" icon={<FileUp size={15} />} onClick={() => setImportOpen(true)}>
              Excel import
            </Button>
            <Button icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>
              Yangi ferma
            </Button>
          </>
        }
      />

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-52 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom yoki STIR bo‘yicha qidirish…" className="pl-8" />
        </div>
        <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="w-40">
          <option value="active">Faol</option>
          <option value="archived">Arxivlangan</option>
          <option value="all">Barchasi</option>
        </Select>
        <Select value={group} onChange={(event) => setGroup(event.target.value)} className="w-44">
          <option value="">Barcha guruhlar</option>
          {(list.data?.groups ?? []).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        {list.data ? <span className="px-1 text-[12px] text-subtle">{list.data.farms.length} ta ferma</span> : null}
      </Card>

      <Card>
        {list.isPending ? (
          <PageLoader />
        ) : list.isError ? (
          <div className="p-5 text-sm text-danger">{errorMessage(list.error)}</div>
        ) : list.data.farms.length === 0 ? (
          <EmptyState
            title="Ferma topilmadi"
            description="Qidiruvni o‘zgartiring yoki yangi ferma qo‘shing. Didox fakturalaridan Excel import ham mumkin."
            icon={<Sprout size={18} />}
            action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Ferma qo‘shish</Button>}
          />
        ) : (
          <TableWrap>
            <thead className="border-b border-line bg-slate-50/60">
              <tr>
                <Th>Ferma</Th>
                <Th>STIR</Th>
                <Th>Guruh</Th>
                <Th>E-IMZO kaliti</Th>
                <Th>Rozilik</Th>
                <Th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {list.data.farms.map((farm) => (
                <tr
                  key={farm.id}
                  onClick={() => setSelectedId(farm.id)}
                  className="group cursor-pointer border-b border-line last:border-0 hover:bg-slate-50/70"
                >
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                        <Sprout size={13.5} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{farm.name}</p>
                        <p className="truncate text-[11px] text-subtle">
                          {farm.status === 'archived' ? 'Arxivlangan' : farm.note || 'Faol'}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-[12px] text-muted">{farm.tin}</Td>
                  <Td>{farm.groupName ? <Badge>{farm.groupName}</Badge> : <span className="text-subtle">—</span>}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <KeyBadge status={farm.key.status} daysLeft={farm.key.daysLeft} />
                      {farm.key.validTo ? <span className="text-[11px] text-subtle">{formatDate(farm.key.validTo)}</span> : null}
                      {farm.key.tinMismatch ? <Badge tone="danger">STIR mos emas</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    {farm.consentAt ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-success"><ShieldCheck size={13} /> {formatDate(farm.consentAt)}</span>
                    ) : (
                      <span className="text-[12px] text-subtle">Yo‘q</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <ChevronRight size={15} className="text-subtle transition-transform group-hover:translate-x-0.5" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <FarmDrawer
        farm={detail.data?.farm ?? null}
        loading={detail.isPending && Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        onChanged={invalidate}
      />

      <CreateFarmModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); invalidate(); setSelectedId(id); }} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={invalidate} />
    </div>
  );
}

function FarmDrawer({
  farm,
  loading,
  onClose,
  onChanged,
}: {
  farm: Farm | null;
  loading: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', tin: '', groupName: '', note: '', oneCUrl: '' });
  const [saving, setSaving] = useState(false);
  const [keyPassword, setKeyPassword] = useState('');
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [credential, setCredential] = useState({ platform: 'didox' as Platform, login: '', password: '', eriPassword: '', oneCUrl: '' });
  const [credBusy, setCredBusy] = useState(false);

  useEffect(() => {
    if (!farm) return;
    setForm({
      name: farm.name,
      tin: farm.tin,
      groupName: farm.groupName ?? '',
      note: farm.note ?? '',
      oneCUrl: farm.oneCUrl ?? '',
    });
    const didox = farm.credentials?.find((item) => item.platform === 'didox');
    setCredential((previous) => ({ ...previous, login: didox?.login ?? '' }));
  }, [farm]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['farm', farm?.id] });
    onChanged();
  };

  const saveFarm = async (event: FormEvent) => {
    event.preventDefault();
    if (!farm) return;
    setSaving(true);
    try {
      await api.patch(`/farms/${farm.id}`, {
        name: form.name,
        tin: form.tin,
        groupName: form.groupName || undefined,
        note: form.note || undefined,
        oneCUrl: form.oneCUrl || '',
      });
      toast.success('Ferma saqlandi.');
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const uploadKey = async () => {
    if (!farm) return;
    if (!keyFile) {
      toast.error('Kalit faylini tanlang (.pfx).');
      return;
    }
    setKeyBusy(true);
    const formData = new FormData();
    formData.append('file', keyFile);
    formData.append('password', keyPassword);
    try {
      const result = await api.upload<{ key: { subject: string; tin: string | null; notAfter: string; tinMismatch: boolean } }>(`/farms/${farm.id}/key`, formData);
      toast.success(`Kalit biriktirildi: ${result.key.subject}`);
      if (result.key.tinMismatch) toast.warning('Diqqat: kalitdagi STIR ferma STIR’idan farq qiladi.');
      setKeyFile(null);
      setKeyPassword('');
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setKeyBusy(false);
    }
  };

  const saveCredential = async (event: FormEvent) => {
    event.preventDefault();
    if (!farm) return;
    setCredBusy(true);
    try {
      const payload: Record<string, string> = { platform: credential.platform };
      if (credential.login) payload.login = credential.login;
      if (credential.password) payload.password = credential.password;
      if (credential.eriPassword && credential.platform === 'didox') payload.eriPassword = credential.eriPassword;
      if (credential.oneCUrl) payload.oneCUrl = credential.oneCUrl;
      await api.put(`/farms/${farm.id}/credentials`, payload);
      toast.success('Kirish ma’lumotlari shifrlab saqlandi.');
      setCredential((previous) => ({ ...previous, password: '', eriPassword: '' }));
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCredBusy(false);
    }
  };

  const action = async (path: string, message: string) => {
    if (!farm) return;
    try {
      await api.post(`/farms/${farm.id}/${path}`);
      toast.success(message);
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const deleteKey = async () => {
    if (!farm) return;
    try {
      await api.del(`/farms/${farm.id}/key`);
      toast.success('Kalit olib tashlandi.');
      refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const downloadKey = async () => {
    if (!farm) return;
    try {
      await downloadFile(`/farms/${farm.id}/key-file`, `key-${farm.tin}.pfx`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Drawer
      open={Boolean(farm) || loading}
      onClose={onClose}
      title={farm?.name ?? 'Yuklanmoqda…'}
      subtitle={farm ? `STIR ${farm.tin} · ${farm.groupName ?? 'guruhsiz'}` : undefined}
    >
      {!farm ? (
        <PageLoader />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border border-border bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <KeyBadge status={farm.key.status} daysLeft={farm.key.daysLeft} />
              {farm.key.tinMismatch ? <Badge tone="danger">STIR mos emas</Badge> : null}
              {farm.status === 'archived' ? <Badge tone="neutral">Arxivlangan</Badge> : <Badge tone="success">Faol</Badge>}
            </div>
            <div className="flex gap-1.5">
              {farm.status === 'active' ? (
                <Button size="sm" variant="ghost" icon={<Archive size={13} />} onClick={() => action('archive', 'Ferma arxivlandi.')}>Arxiv</Button>
              ) : (
                <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => action('restore', 'Ferma tiklandi.')}>Tiklash</Button>
              )}
            </div>
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted"><Pencil size={13} /> Rekvizitlar</h3>
            <form onSubmit={saveFarm} className="space-y-3">
              <Field label="Ferma nomi" required>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="STIR" required hint="9 raqam">
                  <Input value={form.tin} maxLength={9} className="font-mono" onChange={(event) => setForm({ ...form, tin: event.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field label="Guruh">
                  <Input value={form.groupName} onChange={(event) => setForm({ ...form, groupName: event.target.value })} />
                </Field>
              </div>
              <Field label="1C manzili" hint="ixtiyoriy">
                <Input value={form.oneCUrl} onChange={(event) => setForm({ ...form, oneCUrl: event.target.value })} placeholder="https://1c.example.uz/…" className="font-mono text-[12px]" />
              </Field>
              <Field label="Izoh" hint="ichki eslatma">
                <Textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} rows={2} />
              </Field>
              <div className="flex justify-between">
                {farm.consentAt ? (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-success"><UserCheck size={13} /> Rozilik: {formatDateTime(farm.consentAt)}</span>
                ) : (
                  <Button type="button" size="sm" variant="secondary" icon={<ShieldCheck size={13} />} onClick={() => action('consent', 'Rozilik qayd etildi.')}>
                    Rozilikni qayd etish
                  </Button>
                )}
                <Button type="submit" size="sm" loading={saving}>Saqlash</Button>
              </div>
            </form>
          </section>

          <section className="border-t border-line pt-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted"><KeyRound size={13} /> E-IMZO kaliti</h3>
            {farm.key.attached ? (
              <div className="space-y-2.5 rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-medium">{farm.key.subject}</p>
                    <p className="font-mono text-[11px] text-subtle">STIR {farm.key.tin ?? '—'} · {formatDate(farm.key.validTo)} gacha</p>
                    <p className="mt-0.5 text-[11px] text-subtle">Biriktirilgan: {formatDateTime(farm.key.attachedAt)}</p>
                  </div>
                  <Badge tone={farm.key.status === 'ok' ? 'success' : farm.key.status === 'expiring' ? 'warn' : 'danger'}>
                    {farm.key.daysLeft !== null ? `${farm.key.daysLeft} kun` : '—'}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Download size={13} />} onClick={downloadKey}>Yuklab olish</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={deleteKey}>Olib tashlash</Button>
                </div>
              </div>
            ) : (
              <p className="mb-2 text-[12px] text-muted">Kalit biriktirilmagan. E-IMZO bilan ishlaydigan scenariylar bu fermani o‘tkazib yuboradi.</p>
            )}

            <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <label className="flex h-9.5 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 text-[12px] text-muted hover:border-primary/40 hover:text-foreground">
                <Upload size={13} />
                <span className="truncate">{keyFile ? keyFile.name : '.pfx fayl tanlash'}</span>
                <input
                  type="file"
                  accept=".pfx,.p12"
                  className="hidden"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setKeyFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Input type="password" value={keyPassword} onChange={(event) => setKeyPassword(event.target.value)} placeholder="Kalit paroli" />
              <Button size="sm" className="h-9.5" loading={keyBusy} onClick={uploadKey}>Biriktirish</Button>
            </div>
            <p className="mt-1.5 text-[11px] text-subtle">Fayl shifrlanadi va faqat shu vault ichida saqlanadi. Parol qayta ishlatilmaydi.</p>
          </section>

          <section className="border-t border-line pt-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-muted"><ShieldCheck size={13} /> Platforma kirishlari</h3>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(farm.credentials ?? []).length === 0 ? (
                <span className="text-[11.5px] text-subtle">Hali kirish ma’lumoti saqlanmagan.</span>
              ) : (
                (farm.credentials ?? []).map((item) => (
                  <span key={item.platform} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px]">
                    <PlatformBadge platform={item.platform} />
                    {item.hasPassword ? <span className="text-success">parol</span> : null}
                    {item.hasEriPassword ? <span className="text-warn">ERI</span> : null}
                  </span>
                ))
              )}
            </div>
            <form onSubmit={saveCredential} className="space-y-2.5 rounded-lg border border-border p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Platforma">
                  <Select value={credential.platform} onChange={(event) => setCredential({ ...credential, platform: event.target.value as Platform })} className="h-8.5">
                    {(Object.keys(platformLabels) as Platform[]).filter((item) => item !== 'other').map((item) => (
                      <option key={item} value={item}>{platformLabels[item]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Login">
                  <Input value={credential.login} onChange={(event) => setCredential({ ...credential, login: event.target.value })} placeholder="login" className="h-8.5 font-mono text-[12px]" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Parol" hint="bo‘sh = o‘zgarmaydi">
                  <Input type="password" value={credential.password} onChange={(event) => setCredential({ ...credential, password: event.target.value })} placeholder="••••••" className="h-8.5" />
                </Field>
                <Field label="ERI paroli" hint="faqat Didox">
                  <Input type="password" value={credential.eriPassword} onChange={(event) => setCredential({ ...credential, eriPassword: event.target.value })} placeholder="••••••" className="h-8.5" disabled={credential.platform !== 'didox'} />
                </Field>
              </div>
              {credential.platform === '1c' ? (
                <Field label="1C URL" hint="bazaga kirish manzili">
                  <Input value={credential.oneCUrl} onChange={(event) => setCredential({ ...credential, oneCUrl: event.target.value })} className="h-8.5 font-mono text-[12px]" />
                </Field>
              ) : null}
              <div className="flex items-center justify-between">
                <p className="text-[10.5px] leading-snug text-subtle">Parollar AES-256 bilan shifrlanadi. UI’da hech qachon ko‘rsatilmaydi.</p>
                <Button type="submit" size="sm" loading={credBusy}>Saqlash</Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function CreateFarmModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ name: '', tin: '', groupName: '', note: '', oneCUrl: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', tin: '', groupName: '', note: '', oneCUrl: '' });
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.post<{ farm: Farm }>('/farms', {
        name: form.name,
        tin: form.tin,
        groupName: form.groupName || undefined,
        note: form.note || undefined,
        oneCUrl: form.oneCUrl || undefined,
      });
      toast.success('Ferma qo‘shildi.');
      onCreated(result.farm.id);
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
      title="Yangi ferma"
      description="Kamida nom va 9 xonali STIR kerak. Qolganini keyin to‘ldirish mumkin."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button form="create-farm" type="submit" loading={busy}>Qo‘shish</Button>
        </>
      }
    >
      <form id="create-farm" onSubmit={submit} className="space-y-3">
        <Field label="Ferma nomi" required>
          <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Masalan: BIG WORLD RETAIL MCHJ" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="STIR" required hint="9 raqam">
            <Input value={form.tin} maxLength={9} className="font-mono" onChange={(event) => setForm({ ...form, tin: event.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Guruh">
            <Input value={form.groupName} onChange={(event) => setForm({ ...form, groupName: event.target.value })} placeholder="Agro" />
          </Field>
        </div>
        <Field label="1C manzili" hint="ixtiyoriy">
          <Input value={form.oneCUrl} onChange={(event) => setForm({ ...form, oneCUrl: event.target.value })} className="font-mono text-[12px]" />
        </Field>
      </form>
    </Modal>
  );
}

type ImportResult = { created: number; updated: number; errors: Array<{ row: number; message: string }>; headers: string[] };

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
    }
  }, [open]);

  const submit = async () => {
    if (!file) {
      toast.error('Excel yoki CSV fayl tanlang.');
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const data = await api.upload<ImportResult>('/farms/import', formData);
      setResult(data);
      onDone();
      toast.success(`Import tugadi: ${data.created} yangi, ${data.updated} yangilandi.`);
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
      title="Fermalar importi"
      description="Excel (.xlsx) yoki CSV: “Nomi” va “STIR” ustunlari bo‘lishi shart. Guruh, izoh va 1C ustunlari ixtiyoriy."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button loading={busy} onClick={submit} icon={<FileUp size={15} />}>Import qilish</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-7 text-center hover:border-primary/40">
          <FileUp size={22} className="text-subtle" />
          <span className="text-[13px] font-medium">{file ? file.name : 'Fayl tanlang'}</span>
          <span className="text-[11.5px] text-subtle">.xlsx yoki .csv · 10 MB gacha</span>
          <input
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {result ? (
          <div className="rounded-lg border border-border bg-slate-50/60 p-3">
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Badge tone="success">+{result.created} yangi</Badge>
              <Badge tone="info">{result.updated} yangilandi</Badge>
              {result.errors.length ? <Badge tone="danger">{result.errors.length} xato</Badge> : null}
            </div>
            {result.headers.length ? (
              <p className="mt-2 font-mono text-[10.5px] text-subtle">Ustunlar: {result.headers.join(' · ')}</p>
            ) : null}
            {result.errors.length ? (
              <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto text-[11.5px] text-danger">
                {result.errors.slice(0, 8).map((error) => (
                  <li key={`${error.row}-${error.message}`}>{error.row}-qator: {error.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
