import { DemoError, demoDownload, demoRequest } from './demo';

export const DEMO_MODE = import.meta.env.VITE_DEMO === '1';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const LOCK_EVENT = 'rpa:locked';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (DEMO_MODE) {
    try {
      return (await demoRequest(path, init)) as T;
    } catch (error) {
      if (error instanceof DemoError) throw new ApiError(error.status, error.code, error.message);
      throw error;
    }
  }

  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { credentials: 'include', ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Serverga ulanib bo‘lmadi. API ishlayaptimi?');
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const record = (body ?? {}) as { code?: string; message?: string };
    if (response.status === 401) window.dispatchEvent(new Event(LOCK_EVENT));
    throw new ApiError(response.status, record.code ?? `HTTP_${response.status}`, record.message ?? 'Xatolik yuz berdi.');
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST') => request<T>(path, { method, body: form }),
};

export const onLock = (handler: () => void): (() => void) => {
  window.addEventListener(LOCK_EVENT, handler);
  return () => window.removeEventListener(LOCK_EVENT, handler);
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Xatolik yuz berdi.';
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  let blob: Blob;
  if (DEMO_MODE) {
    const file = demoDownload(path);
    blob = file.blob;
    filename = file.filename;
  } else {
    const response = await fetch(`/api${path}`, { credentials: 'include' });
    if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Faylni yuklab bo‘lmadi.');
    blob = await response.blob();
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
