import { createPortal } from 'react-dom';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X, Inbox, Loader2 } from 'lucide-react';
import { cx } from '@/lib/format';
import type { FarmRunStatus, Platform, RunStatus } from '@/lib/types';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover shadow-card',
    secondary: 'bg-surface text-foreground border border-border hover:bg-slate-50 shadow-card',
    ghost: 'text-muted hover:text-foreground hover:bg-slate-100',
    danger: 'bg-danger text-white hover:bg-red-800 shadow-card',
    soft: 'bg-primary-soft text-primary hover:bg-blue-100',
  };
  const sizes: Record<string, string> = {
    sm: 'h-8 px-3 text-[13px] gap-1.5',
    md: 'h-9.5 px-4 text-sm gap-2',
    icon: 'h-9 w-9 justify-center',
  };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1',
        'disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

const controlClass =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-subtle outline-none transition-shadow focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:bg-slate-50 disabled:text-subtle';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(controlClass, 'h-9.5', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(controlClass, 'py-2 min-h-20', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(controlClass, 'h-9.5 pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block space-y-1.5', className)}>
      <span className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-foreground">
        <span>
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </span>
        {hint ? <span className="text-[11px] font-normal text-subtle">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="block text-[12px] text-danger">{error}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-border bg-surface shadow-card', className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger' | 'primary';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  info: 'bg-info-soft text-info ring-sky-200',
  success: 'bg-success-soft text-success ring-emerald-200',
  warn: 'bg-warn-soft text-warn ring-amber-200',
  danger: 'bg-danger-soft text-danger ring-red-200',
  primary: 'bg-primary-soft text-primary ring-blue-200',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const runStatusMap: Record<RunStatus, { label: string; tone: Tone }> = {
  awaiting_approval: { label: 'Tasdiq kutilmoqda', tone: 'warn' },
  running: { label: 'Ishlamoqda', tone: 'info' },
  paused: { label: "To‘xtatilgan", tone: 'warn' },
  cancelled: { label: 'Bekor qilindi', tone: 'neutral' },
  completed: { label: 'Tugadi', tone: 'success' },
  failed: { label: 'Xato', tone: 'danger' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = runStatusMap[status] ?? { label: status, tone: 'neutral' as Tone };
  return (
    <Badge tone={meta.tone}>
      {status === 'running' ? <span className="h-1.5 w-1.5 rounded-full bg-info pulse-dot" /> : null}
      {meta.label}
    </Badge>
  );
}

const farmStatusMap: Record<FarmRunStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Navbatda', tone: 'neutral' },
  running: { label: 'Ishlamoqda', tone: 'info' },
  done: { label: 'Bajarildi', tone: 'success' },
  error: { label: 'Xato', tone: 'danger' },
  skipped: { label: 'O‘tkazildi', tone: 'warn' },
};

export function FarmStatusBadge({ status }: { status: FarmRunStatus }) {
  const meta = farmStatusMap[status] ?? { label: status, tone: 'neutral' as Tone };
  return (
    <Badge tone={meta.tone}>
      {status === 'running' ? <span className="h-1.5 w-1.5 rounded-full bg-info pulse-dot" /> : null}
      {meta.label}
    </Badge>
  );
}

export const platformLabels: Record<Platform, string> = {
  didox: 'Didox',
  '1c': '1C',
  my3: 'My3 Soliq',
  eijara: 'E-ijara',
  other: 'Boshqa',
};

export const platformTones: Record<Platform, Tone> = {
  didox: 'primary',
  '1c': 'info',
  my3: 'warn',
  eijara: 'success',
  other: 'neutral',
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return <Badge tone={platformTones[platform] ?? 'neutral'}>{platformLabels[platform] ?? platform}</Badge>;
}

export function KeyBadge({ status, daysLeft }: { status: 'missing' | 'expired' | 'expiring' | 'ok'; daysLeft: number | null }) {
  if (status === 'missing') return <Badge tone="danger">Kalit yo‘q</Badge>;
  if (status === 'expired') return <Badge tone="danger">Muddati tugagan</Badge>;
  if (status === 'expiring') return <Badge tone="warn">{daysLeft ?? 0} kun qoldi</Badge>;
  return <Badge tone="success">Amalda</Badge>;
}

export function Progress({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'success' | 'danger' }) {
  const colors = { primary: 'bg-primary', success: 'bg-success', danger: 'bg-danger' };
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', colors[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={18} className={cx('animate-spin text-muted', className)} />;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-muted">
        {icon ?? <Inbox size={18} />}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-slate-900/35 anim-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" className={cx('relative z-10 w-full rounded-xl border border-border bg-surface shadow-pop anim-up', widths[width])}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-slate-100 hover:text-foreground" aria-label="Yopish">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/30 anim-fade" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-pop anim-left">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold">{title}</h2>
            {subtitle ? <p className="mt-0.5 font-mono text-[12px] text-muted">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-slate-100 hover:text-foreground" aria-label="Yopish">
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('px-3 py-2 text-left text-[11.5px] font-semibold uppercase tracking-wide text-subtle', className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cx('px-3 py-2.5 text-[13px] align-middle', className)}>
      {children}
    </td>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('scroll-thin overflow-x-auto', className)}>
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

export function PageLoader({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-20 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-danger-soft px-5 py-10 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Qayta urinish
        </Button>
      ) : null}
    </div>
  );
}
