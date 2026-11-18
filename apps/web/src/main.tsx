import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import '@fontsource/fira-sans/400.css';
import '@fontsource/fira-sans/500.css';
import '@fontsource/fira-sans/600.css';
import '@fontsource-variable/fira-code';
import './index.css';

import { api, onLock } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { PageLoader } from '@/components/ui';
import { AuthPage } from '@/pages/AuthPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { FarmsPage } from '@/pages/FarmsPage';
import { ScenariosPage } from '@/pages/ScenariosPage';
import { ScenarioEditorPage } from '@/pages/ScenarioEditorPage';
import { DatasetsPage } from '@/pages/DatasetsPage';
import { RunsPage } from '@/pages/RunsPage';
import { RunDetailPage } from '@/pages/RunDetailPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AuditPage } from '@/pages/AuditPage';
import { SettingsPage } from '@/pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof Error && 'status' in error && (error as { status: number }).status < 500) && count < 1,
      staleTime: 5_000,
    },
  },
});

function App() {
  const client = useQueryClient();
  const auth = useQuery({
    queryKey: ['auth'],
    queryFn: () => api.get<{ setup: boolean; unlocked: boolean }>('/auth/status'),
    staleTime: 0,
  });

  useEffect(
    () =>
      onLock(() => {
        client.setQueryData(['auth'], (previous: { setup: boolean; unlocked: boolean } | undefined) => ({
          setup: previous?.setup ?? true,
          unlocked: false,
        }));
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      }),
    [client],
  );

  if (auth.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PageLoader label="Tizim tekshirilmoqda…" />
      </div>
    );
  }

  if (auth.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium">Server javob bermayapti</p>
        <p className="max-w-md text-[13px] text-muted">
          API ishga tushirilganiga ishonch hosil qiling: <code className="font-mono text-[12px]">npm run dev</code>
        </p>
        <button className="text-[13px] font-medium text-primary hover:underline" onClick={() => auth.refetch()}>
          Qayta urinish
        </button>
      </div>
    );
  }

  if (!auth.data?.unlocked) {
    return <AuthPage setup={!auth.data?.setup} />;
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="farms" element={<FarmsPage />} />
        <Route path="scenarios" element={<ScenariosPage />} />
        <Route path="scenarios/:id" element={<ScenarioEditorPage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <App />
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontSize: '13px' } }} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
