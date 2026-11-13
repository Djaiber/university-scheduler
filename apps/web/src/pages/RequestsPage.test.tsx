import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestsPage } from './RequestsPage';
import { mockApi, renderAt } from '../test-utils';

describe('RequestsPage', () => {
  beforeEach(() => localStorage.clear());

  it('lista solicitudes con su estado', async () => {
    mockApi({
      'GET /v1/schedule-requests': [{ id: 'r1', period: '2027-1', status: 'PENDING_REVIEW', alternatives_requested: 4,
        optimization_profile: 'balanced', time_limit_seconds: 120, requested_by: 'ana', created_at: '2026-10-26T15:00:00Z' }],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }]);
    expect(await screen.findByText('Pendiente de revisión')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Balanceado' })).toBeInTheDocument();
  });

  it('el administrador genera cuando la oferta está consolidada y navega al detalle', async () => {
    const { calls } = mockApi({
      'GET /v1/schedule-requests': [],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
      'GET /v1/programs': [{ id: 'x', code: 'SIS', name: 'Sistemas', faculty: 'Ingeniería' }],
      'GET /v1/offers': { period: '2027-1', programs: [{ program: 'SIS', groups: 8, state: 'CONSOLIDADA', consolidation: null }] },
      'POST /v1/schedule-requests': { request_id: 'nuevo', run_id: 'x', status: 'QUEUED', published: true },
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }, { path: '/requests/:id', element: <p>detalle</p> }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'compact');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('detalle')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ period: '2027-1', alternatives_requested: 4, optimization_profile: 'compact', time_limit_seconds: 120 });
    expect(post.headers).toMatchObject({ 'x-actor': 'admin@unbosque.edu.co', 'x-roles': 'ADMINISTRADOR' });
  });

  it('no deja generar mientras falte la consolidación de la oferta por el director', async () => {
    mockApi({
      'GET /v1/schedule-requests': [],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
      'GET /v1/programs': [{ id: 'x', code: 'SIS' }, { id: 'y', code: 'MED' }],
      'GET /v1/offers': { period: '2027-1', programs: [
        { program: 'MED', groups: 3, state: 'DESACTUALIZADA', consolidation: null },
        { program: 'SIS', groups: 8, state: 'CONSOLIDADA', consolidation: null },
      ] },
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }]);
    expect(await screen.findByText(/consolide la oferta de MED/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Programa'), 'SIS');
    expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled();
  });

  it('el comité y el director no ven el formulario de generación', async () => {
    localStorage.setItem('scheduler.session', JSON.stringify({ actor: 'comite@x.co', roles: ['COMITE_TACTICO'], token: null }));
    mockApi({ 'GET /v1/schedule-requests': [], 'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }] });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }]);
    expect(await screen.findByText('Aún no hay solicitudes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generar' })).not.toBeInTheDocument();
  });

  it('muestra el error de validación de la API', async () => {
    mockApi({
      'GET /v1/schedule-requests': [],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
      'GET /v1/programs': [],
      'GET /v1/offers': { period: '2027-1', programs: [] },
      'POST /v1/schedule-requests': () => new Response(JSON.stringify({ message: 'No hay grupos para el período' }), { status: 400 }),
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay grupos para el período');
  });
});
