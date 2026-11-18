import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Database, FileSpreadsheet, FileUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Dataset, DatasetCoverage } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageLoader, TableWrap, Td, Th } from '@/components/ui';

export function DatasetsPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const list = useQuery({ queryKey: ['datasets'], queryFn: () => api.get<{ datasets: Dataset[] }>('/datasets') });

  useEffect(() => {
    if (!selectedId && list.data?.datasets[0]) setSelectedId(list.data.datasets[0].id);
  }, [list.data, selectedId]);

  const detail = useQuery({
    queryKey: ['dataset', selectedId],
    queryFn: () => api.get<{ dataset: Dataset; coverage: DatasetCoverage[] }>(`/datasets/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const remove = async () => {
    if (!selectedId) return;
    if (!window.confirm('To‘plam o‘chirilsinmi? Unga bog‘langan qiymatlar ham o‘chadi.')) return;
    try {
      await api.del(`/datasets/${selectedId}`);
      toast.success('To‘plam o‘chirildi.');
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['datasets'] });
    void queryClient.invalidateQueries({ queryKey: ['dataset'] });
  };

  const datasets = list.data?.datasets ?? [];
  const coverage = detail.data?.coverage ?? [];
  const complete = coverage.filter((farm) => farm.missing.length === 0).length;

  return (
    <div>
      <PageHeader
        title="Ma’lumotlar to‘plamlari"
        description="Excel yoki CSV’dan fermalar bo‘yicha qiymatlar. Ustun nomi scenariyodagi o‘zgaruvchi nomiga mos bo‘lsa, avtomatik ishlaydi."
        actions={<Button icon={<FileUp size={15} />} onClick={() => setImportOpen(true)}>Yangi to‘plam</Button>}
      />

      {list.isPending ? (
        <PageLoader />
      ) : datasets.length === 0 ? (
        <Card>
          <EmptyState
            title="To‘plam yo‘q"
            description="Oylik summalar jadvalini yuklang: STIR ustuni va o‘zgaruvchi ustunlari bo‘lishi kerak."
            icon={<Database size={18} />}
            action={<Button size="sm" icon={<FileUp size={14} />} onClick={() => setImportOpen(true)}>Excel yuklash</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            {datasets.map((dataset) => (
              <button
                key={dataset.id}
                onClick={() => setSelectedId(dataset.id)}
                className={
                  'w-full rounded-xl border p-3 text-left transition-colors ' +
                  (dataset.id === selectedId ? 'border-primary/40 bg-primary-soft/50' : 'border-border bg-surface hover:border-slate-300')
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={'flex h-7 w-7 items-center justify-center rounded-md ' + (dataset.id === selectedId ? 'bg-primary text-white' : 'bg-slate-100 text-muted')}>
                    <FileSpreadsheet size={13.5} />
                  </span>
                  <Badge tone="neutral">{dataset.rowsCount} ferma</Badge>
                </div>
                <p className="mt-1.5 truncate text-[13px] font-medium">{dataset.name}</p>
                <p className="truncate font-mono text-[10.5px] text-subtle">{dataset.sourceName ?? '—'}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {dataset.columns.slice(0, 4).map((column) => (
                    <span key={column} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-muted">{column}</span>
                  ))}
                  {dataset.columns.length > 4 ? <span className="text-[10px] text-subtle">+{dataset.columns.length - 4}</span> : null}
                </div>
              </button>
            ))}
          </div>

          <Card className="overflow-hidden">
            {detail.isPending || !detail.data ? (
              <PageLoader />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5">
                  <div>
                    <h2 className="text-[15px] font-semibold">{detail.data.dataset.name}</h2>
                    <p className="text-[11.5px] text-muted">
                      {detail.data.dataset.sourceName ?? 'Manba ko‘rsatilmagan'} · {formatDate(detail.data.dataset.createdAt)} · {detail.data.dataset.rowsCount} ferma qatori
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {detail.data.dataset.columns.map((column) => (
                        <Badge key={column} tone="primary">{column}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={complete === coverage.length ? 'success' : 'warn'}>
                      {complete}/{coverage.length} to‘liq
                    </Badge>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={remove}>O‘chirish</Button>
                  </div>
                </div>

                <TableWrap>
                  <thead className="border-b border-line bg-slate-50/60">
                    <tr>
                      <Th>Ferma</Th>
                      <Th>STIR</Th>
                      <Th>Qamrov</Th>
                      <Th>Yetishmayotgan ustunlar</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map((farm) => (
                      <tr key={farm.tin} className="border-b border-line last:border-0">
                        <Td className="font-medium">{farm.name}</Td>
                        <Td className="font-mono text-[12px] text-muted">{farm.tin}</Td>
                        <Td>
                          {farm.missing.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-[12px] text-success"><CheckCircle2 size={13} /> To‘liq</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[12px] text-warn"><AlertTriangle size={13} /> {farm.missing.length} yetishmaydi</span>
                          )}
                        </Td>
                        <Td>
                          {farm.missing.length ? (
                            <div className="flex flex-wrap gap-1">
                              {farm.missing.map((column) => (
                                <span key={column} className="rounded bg-danger-soft px-1 py-0.5 font-mono text-[10.5px] text-danger">{column}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[12px] text-subtle">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>

                <div className="border-t border-line bg-slate-50/50 px-4 py-2.5 text-[11px] leading-relaxed text-muted">
                  Qiymati yo‘q ferma run’da sababi bilan o‘tkazib yuboriladi — xato fermaga yozilmaydi.
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      <ImportDatasetModal open={importOpen} onClose={() => setImportOpen(false)} onDone={(id) => { setImportOpen(false); setSelectedId(id); refresh(); }} />
    </div>
  );
}

function ImportDatasetModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ dataset: Dataset; unknownTins: string[]; preview: Array<Record<string, string>> } | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setName('');
      setResult(null);
    }
  }, [open]);

  const submit = async () => {
    if (!file) {
      toast.error('Fayl tanlanmagan.');
      return;
    }
    setBusy(true);
    const formData = new FormData();
    formData.append('file', file);
    if (name) formData.append('name', name);
    try {
      const data = await api.upload<{ dataset: Dataset; unknownTins: string[]; preview: Array<Record<string, string>> }>('/datasets', formData);
      setResult(data);
      toast.success(`To‘plam yuklandi: ${data.dataset.rowsCount} ferma, ${data.dataset.columns.length} ustun.`);
      onDone(data.dataset.id);
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
      title="Yangi ma’lumotlar to‘plami"
      description="Birinchi ustun yoki “STIR” ustuni fermani aniqlaydi; qolgan ustunlar o‘zgaruvchilar bo‘ladi."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Yopish</Button>
          <Button loading={busy} onClick={submit} icon={<FileUp size={15} />}>Yuklash</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nomi" hint="ixtiyoriy">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Masalan: Noyabr 2026 — oylik summalar" />
        </Field>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-7 text-center hover:border-primary/40">
          <FileSpreadsheet size={22} className="text-subtle" />
          <span className="text-[13px] font-medium">{file ? file.name : 'Excel yoki CSV tanlang'}</span>
          <span className="text-[11.5px] text-subtle">.xlsx yoki .csv · 20 MB gacha</span>
          <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>

        {result ? (
          <div className="space-y-2 rounded-lg border border-border bg-slate-50/60 p-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="success">{result.dataset.rowsCount} ferma</Badge>
              {result.dataset.columns.map((column) => <Badge key={column} tone="primary">{column}</Badge>)}
            </div>
            {result.unknownTins.length ? (
              <p className="text-[11.5px] text-warn">
                Tanilmagan STIR’lar: <span className="font-mono text-[11px]">{result.unknownTins.slice(0, 6).join(', ')}</span>
                {result.unknownTins.length > 6 ? '…' : ''}
              </p>
            ) : null}
            {result.preview.length ? (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-subtle">
                      {Object.keys(result.preview[0] ?? {}).map((header) => <th key={header} className="px-1 py-0.5 font-medium">{header}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.preview.map((row, index) => (
                      <tr key={index} className="border-t border-line">
                        {Object.keys(result.preview[0] ?? {}).map((header) => (
                          <td key={header} className="max-w-32 truncate px-1 py-0.5 text-muted">{row[header]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
