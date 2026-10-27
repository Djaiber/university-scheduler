import { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { SessionProvider } from './session';

type Handler = (url: string, init?: RequestInit) => unknown;

/** Sustituye fetch: cada ruta `MÉTODO /path` devuelve un JSON (o un Response). Registra las llamadas. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: { method: string; url: string; body?: unknown; headers?: HeadersInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && new RegExp(`^${p.replace(/:[^/]+/g, '[^/?]+')}(\\?.*)?$`).test(url);
    });
    if (!key) return new Response(JSON.stringify({ message: `sin mock: ${method} ${url}` }), { status: 404 });
    const value = routes[key];
    const out = typeof value === 'function' ? (value as Handler)(url, init) : value;
    return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderAt(path: string, routes: { path: string; element: ReactElement }[]) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{routes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}</Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}
