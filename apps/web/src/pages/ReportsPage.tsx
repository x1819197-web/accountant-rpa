import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, CheckCircle2, Download, FileSpreadsheet, XCircle, Clock3 } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration, toDateInput } from '@/lib/format';
import type { RunStatus } from '@/lib/types';
import { Badge, Button, Card, EmptyState, PageHeader, PageLoader, Progress, RunStatusBadge, TableWrap, Td, Th } from '@/components/ui';

interface ReportRun {
  id: string;
  scenarioName: string;
  scenarioVersion: number;
  mode: string;
  runner: string;
  status: RunStatus;
  totalFarms: number;
  doneCount: number;
  errorCount: number;
  skippedCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface ReportResponse {
  from: string;
  to: string;
  totals: { runs: number; farms: number; done: number; errors: number; skipped: number };
  runs: ReportRun[];
}

export function ReportsPage() {
  const [from, setFrom] = useState(() => toDateInput(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => toDateInput(new Date()));

  const report = useQuery({
    queryKey: ['report', from, to],
    queryFn: () =>
      api.get<ReportResponse>(
        `/reports/runs?from=${new Date(`${from}T00:00:00+05:00`).toISOString()}&to=${new Date(`${to}T23:59:59.999+05:00`).toISOString()}`,
      ),
  });

  const preset = (days: number) => {
    setFrom(toDateInput(new Date(Date.now() - (days - 1) * 86_400_000)));
    setTo(toDateInput(new Date()));
  };

  const data = report.data;
  const processed = data ? data.totals.done + data.totals.errors : 0;
  const successRate = data && processed ? Math.round((data.totals.done / processed) * 100) : 0;

  const exportRun = async (run: ReportRun) => {
    try {
      await downloadFile(`/reports/runs/${run.id}/export.xlsx`, `run-${run.id.slice(0, 8)}.xlsx`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div>
      <PageHeader
        title="Hisobotlar"
        description="Davr bo‘yicha barcha runlar, fermalar va xatolar. Har runni Excel’ga yuklab olish mumkin — qiymatlar bilan."
      />

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Dan</label>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px]" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Gacha</label>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px]" />
        </div>
        <div className="flex gap-1 pb-0.5">
          {[7, 30, 90].map((days) => (
            <Button key={days} size="sm" variant="secondary" onClick={() => preset(days)}>{days} kun</Button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1 pb-1 text-[11.5px] text-subtle">
          <CalendarRange size={13} /> {from} — {to}
        </span>
      </Card>

      {report.isPending ? (
        <PageLoader />
      ) : !data ? (
        <div className="rounded-xl border border-red-200 bg-danger-soft p-5 text-sm text-danger">{errorMessage(report.error)}</div>
      ) : (
        <>
          <div className="mb-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-3.5">
              <p className="text-[11.5px] text-muted">Runlar</p>
              <p className="mt-1 text-[22px] font-semibold tabular">{data.totals.runs}</p>
              <p className="text-[11px] text-subtle">{data.totals.farms} ferma qamrovi</p>
            </Card>
            <Card className="p-3.5">
              <p className="flex items-center gap-1 text-[11.5px] text-muted"><CheckCircle2 size={12} className="text-success" /> Bajarildi</p>
              <p className="mt-1 text-[22px] font-semibold tabular text-success">{data.totals.done}</p>
              <Progress value={successRate} tone="success" className="mt-2" />
              <p className="mt-1 text-[11px] text-subtle">{successRate}% muvaffaqiyat</p>
            </Card>
            <Card className="p-3.5">
              <p className="flex items-center gap-1 text-[11.5px] text-muted"><XCircle size={12} className="text-danger" /> Xatolar</p>
              <p className="mt-1 text-[22px] font-semibold tabular text-danger">{data.totals.errors}</p>
              <p className="text-[11px] text-subtle">Har biri jurnalda sababi bilan</p>
            </Card>
            <Card className="p-3.5">
              <p className="flex items-center gap-1 text-[11.5px] text-muted"><Clock3 size={12} className="text-warn" /> O‘tkazildi</p>
              <p className="mt-1 text-[22px] font-semibold tabular text-warn">{data.totals.skipped}</p>
              <p className="text-[11px] text-subtle">Kalit/qiymat/parol yetishmagan</p>
            </Card>
          </div>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold"><FileSpreadsheet size={14} /> Runlar</p>
              <span className="text-[11.5px] text-subtle">{data.runs.length} yozuv</span>
            </div>
            {data.runs.length === 0 ? (
              <EmptyState title="Bu davrda run yo‘q" description="Sanani kengaytiring yoki yangi run boshlang." />
            ) : (
              <TableWrap>
                <thead className="border-b border-line bg-slate-50/60">
                  <tr>
                    <Th>Sana</Th>
                    <Th>Scenario</Th>
                    <Th>Rejim</Th>
                    <Th className="text-right">Fermalar</Th>
                    <Th className="text-right">Natija</Th>
                    <Th>Holat</Th>
                    <Th className="text-right">Davomiylik</Th>
                    <Th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id} className="border-b border-line last:border-0 hover:bg-slate-50/70">
                      <Td className="whitespace-nowrap text-[12px] text-muted">{formatDateTime(run.createdAt)}</Td>
                      <Td>
                        <p className="font-medium">{run.scenarioName}</p>
                        <p className="text-[10.5px] text-subtle">v{run.scenarioVersion} · {run.runner === 'desktop' ? 'desktop' : 'simulyatsiya'}</p>
                      </Td>
                      <Td><Badge tone={run.mode === 'dry' ? 'neutral' : 'primary'}>{run.mode === 'dry' ? 'Dry' : 'Live'}</Badge></Td>
                      <Td className="text-right tabular">{run.totalFarms}</Td>
                      <Td className="whitespace-nowrap text-right text-[11.5px]">
                        <span className="text-success">{run.doneCount}</span>
                        <span className="text-subtle"> / </span>
                        <span className="text-danger">{run.errorCount}</span>
                        <span className="text-subtle"> / </span>
                        <span className="text-warn">{run.skippedCount}</span>
                      </Td>
                      <Td><RunStatusBadge status={run.status} /></Td>
                      <Td className="text-right tabular text-[12px] text-muted">
                        {run.startedAt && run.finishedAt
                          ? formatDuration(Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000))
                          : '—'}
                      </Td>
                      <Td className="text-right">
                        <Button size="icon" variant="ghost" title="Excel yuklab olish" onClick={() => exportRun(run)}>
                          <Download size={14} />
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
