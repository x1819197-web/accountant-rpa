import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowRight, CheckCircle2, FolderKanban, KeyRound, ShieldCheck, Sprout, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

export function AuthPage({ setup }: { setup: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!setup && password.length < 8) {
      setError('Parol kamida 8 belgidan iborat bo‘lishi kerak.');
      return;
    }
    if (setup && password !== confirm) {
      setError('Parollar mos kelmadi.');
      return;
    }
    if (setup && !accept) {
      setError('Javobgarlik shartini qabul qiling.');
      return;
    }
    setBusy(true);
    try {
      if (setup) {
        await api.post('/auth/setup', { password, acceptTerms: true });
        toast.success('Master parol o‘rnatildi. Xush kelibsiz!');
      } else {
        await api.post('/auth/login', { password });
      }
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: ['auth'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#132a63] p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-sky-400/10 blur-2xl" />

        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <FolderKanban size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Buxgalter RPA</p>
            <p className="text-[11px] text-blue-200">Hisobchi uchun robot-platforma</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">
            Bir marta yozib oling — 90 ta fermada qayta-qayta bajaring.
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-blue-100/90">
            Didox, 1C, My3 Soliq va E-ijara ishlari fermer xo‘jaliklari bo‘yicha avtomatik bajariladi. Har qadam
            jurnalga yoziladi, imzolash esa har doim sizning qo‘lingizda qoladi.
          </p>
          <div className="mt-7 space-y-2.5 text-[13px]">
            {(
              [
                { label: 'Bir marta yozib olish, cheksiz qayta ijro', Icon: KeyRound },
                { label: 'Xavfsiz vault: kalitlar faqat shu kompyuterda', Icon: ShieldCheck },
                { label: 'Imzolash va yuborish — hech qachon avtomatik emas', Icon: CheckCircle2 },
                { label: 'Har ferma bo‘yicha aniq holat va dalil', Icon: Sprout },
              ] satisfies Array<{ label: string; Icon: LucideIcon }>
            ).map(({ label, Icon }) => (
              <div key={label} className="flex items-center gap-2.5">
                <Icon size={15} className="text-blue-300" />
                <span className="text-blue-50/90">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11.5px] text-blue-200/70">
          Sizning ma’lumotlaringiz shifrlangan holda saqlanadi. .pfx va ERI paroli hech qachon tarmoqqa chiqmaydi.
        </p>
      </div>

      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
              <FolderKanban size={18} />
            </div>
            <p className="text-sm font-semibold">Buxgalter RPA</p>
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight">
            {setup ? 'Master parolni o‘rnating' : 'Tizimga kirish'}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
            {setup
              ? 'Bitta master parol butun vault’ni va sessiyani himoya qiladi. Bu parol saqlanmaydi — uni yodda tuting.'
              : 'Master parolingizni kiriting. 30 daqiqa harakatsizlikdan keyin tizim o‘zi qulflanadi.'}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Master parol" required hint="kamida 8 belgi">
              <Input
                type="password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </Field>

            {setup ? (
              <Field label="Parolni tasdiqlang" required>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </Field>
            ) : null}

            {setup ? (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-slate-50/60 p-3">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(event) => setAccept(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/30"
                />
                <span className="text-[12px] leading-relaxed text-muted">
                  Men ushbu ilovaning har bir amalini o‘z javobgarligim ostida boshqaramanini tushunaman. Ilova
                  hujjatlarni imzolamaydi va yubormaydi — bu har doim buxgalter qo‘lida qoladi.
                </span>
              </label>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-red-200 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div>
            ) : null}

            <Button type="submit" loading={busy} className="w-full" icon={setup ? <ShieldCheck size={16} /> : <ArrowRight size={16} />}>
              {setup ? 'Vault’ni yaratish' : 'Kirish'}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11.5px] leading-relaxed text-subtle">
            {setup
              ? 'Parolni yo‘qotsangiz, vault’dagi sirlarni tiklab bo‘lmaydi.'
              : 'Parolni unutdingizmi? Server administratoriga murojaat qiling.'}
          </p>
        </div>
      </div>
    </div>
  );
}
