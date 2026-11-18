import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Activity,
  ClipboardList,
  Clock3,
  Database,
  FileSpreadsheet,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Lock,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck,
  Sprout,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, DEMO_MODE, errorMessage } from '@/lib/api';
import { cx, formatClock } from '@/lib/format';
import type { Settings } from '@/lib/types';
import { Badge, Button } from '@/components/ui';

const nav = [
  { to: '/', label: 'Boshqaruv', icon: LayoutDashboard, end: true },
  { to: '/farms', label: 'Fermalar', icon: Sprout },
  { to: '/scenarios', label: 'Scenariylar', icon: ListChecks },
  { to: '/datasets', label: "Ma’lumotlar", icon: Database },
  { to: '/runs', label: 'Runlar', icon: Activity },
  { to: '/reports', label: 'Hisobotlar', icon: FileSpreadsheet },
  { to: '/audit', label: 'Jurnal', icon: ClipboardList },
  { to: '/settings', label: 'Sozlamalar', icon: SettingsIcon },
];

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const lock = async () => {
    try {
      await api.post('/auth/lock');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      queryClient.clear();
      navigate('/', { replace: true });
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-card">
          <FolderKanban size={17} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold leading-tight">Buxgalter RPA</p>
          <p className="text-[10.5px] text-subtle">90 ta ferma uchun robot</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5 py-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-slate-100 hover:text-foreground',
              )
            }
          >
            <item.icon size={16} strokeWidth={1.9} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <div className="rounded-lg bg-slate-50 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-muted">Ijrochi</span>
            <Badge tone={settings.data?.runnerMode === 'desktop' ? 'success' : 'info'}>
              {settings.data?.runnerMode === 'desktop' ? 'Desktop robot' : 'Simulyatsiya'}
            </Badge>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-subtle">
            {settings.data?.runnerMode === 'desktop'
              ? 'Desktop ilova navbatdan job olib bajaradi.'
              : 'Xavfsiz sinov rejimi — saytlarga chiqmaydi.'}
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="inline-flex items-center gap-1 text-[11px] text-subtle">
            <ShieldCheck size={12} /> v{settings.data?.version ?? '0.1.0'}
          </span>
          <button onClick={lock} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted hover:bg-slate-100 hover:text-foreground">
            <Lock size={12} /> Qulflash
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 border-r border-border bg-surface lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/35" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-60 border-r border-border bg-surface anim-left">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-3 rounded-md p-1 text-subtle hover:bg-slate-100"
              aria-label="Yopish"
            >
              <X size={17} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-56">
        <header className="sticky top-0 z-30 flex h-13 items-center justify-between gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-muted hover:bg-slate-100 lg:hidden"
              aria-label="Menyu"
            >
              <Menu size={18} />
            </button>
            <span className="text-[13px] font-medium text-muted">
              {nav.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)))?.label ?? 'Boshqaruv'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 text-[11px] font-medium text-muted md:flex" title="Toshkent vaqti (UTC+5)">
              <Clock3 size={13} />
              <span>Toshkent</span>
              <span className="font-mono tabular-nums text-foreground">{formatClock(clock)}</span>
            </div>
            {DEMO_MODE ? (
              <div className="hidden items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-primary sm:flex" title="Brauzerdagi namoyish — simulyatsiya ma’lumotlari">
                <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
                Demo · simulyatsiya
              </div>
            ) : (
              <div className="hidden items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-medium text-success sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
                Server onlayn
              </div>
            )}
            <Button variant="ghost" size="sm" icon={<Lock size={14} />} onClick={lock}>
              Qulflash
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
