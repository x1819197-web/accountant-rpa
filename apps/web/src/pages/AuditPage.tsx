import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Input, PageHeader, PageLoader, TableWrap, Td, Th } from '@/components/ui';

const actionTones: Record<string, 'primary' | 'info' | 'success' | 'warn' | 'danger' | 'neutral'> = {
  auth: 'info',
  farm: 'primary',
  scenario: 'success',
  dataset: 'warn',
  run: 'info',
  settings: 'neutral',
  accountability: 'success',
};

function tone(action: string) {
  return actionTones[action.split('.')[0] ?? ''] ?? 'neutral';
}

function summarize(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const entries = Object.entries(detail as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4);
  return entries.map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ');
}

export function AuditPage() {
  const [search, setSearch] = useState('');
  const audit = useQuery({
    queryKey: ['audit', search],
    queryFn: () => api.get<{ entries: AuditEntry[] }>(`/audit?limit=100&search=${encodeURIComponent(search)}`),
  });

  return (
    <div>
      <PageHeader
        title="Jurnal"
        description="Vault, fermalar, scenariylar va runlardagi har o‘zgarish. Yozuvlar faqat o‘qiladi — API orqali o‘chirilmaydi."
        actions={
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => audit.refetch()}>
            Yangilash
          </Button>
        }
      />

      <Card className="mb-4 flex items-center gap-2 p-2.5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Amal, obyekt yoki tafsilot bo‘yicha qidirish…" className="pl-8" />
        </div>
        <span className="px-1 text-[12px] text-subtle">{audit.data?.entries.length ?? 0} yozuv</span>
      </Card>

      <Card>
        {audit.isPending ? (
          <PageLoader />
        ) : audit.data?.entries.length === 0 ? (
          <EmptyState title="Yozuv topilmadi" description="Qidiruvni o‘zgartiring." icon={<ClipboardList size={18} />} />
        ) : (
          <TableWrap>
            <thead className="border-b border-line bg-slate-50/60">
              <tr>
                <Th className="w-44">Vaqt</Th>
                <Th className="w-56">Amal</Th>
                <Th>Obyekt</Th>
                <Th>Tafsilot</Th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line align-top last:border-0 hover:bg-slate-50/60">
                  <Td className="whitespace-nowrap text-[11.5px] text-muted">{formatDateTime(entry.ts)}</Td>
                  <Td>
                    <Badge tone={tone(entry.action)}>{entry.action}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-[11px] text-muted">
                    {entry.entity ?? '—'}
                    {entry.entityId ? <span className="text-subtle"> #{entry.entityId.slice(0, 8)}</span> : null}
                  </Td>
                  <Td className="text-[11.5px] text-muted">
                    <span className="break-words">{summarize(entry.detail) || '—'}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-subtle">
        <ShieldCheck size={12} /> Jurnal yozuvlari o‘zgarmas — har bir amal kim tomonidan va qachon bajarilganini ko‘rsatadi.
      </p>
    </div>
  );
}
