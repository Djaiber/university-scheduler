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

  it('crea una solicitud con identidad de coordinación y navega al detalle', async () => {
    const { calls } = mockApi({
      'GET /v1/schedule-requests': [],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
      'POST /v1/schedule-requests': { request_id: 'nuevo', run_id: 'x', status: 'QUEUED', published: true },
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }, { path: '/requests/:id', element: <p>detalle</p> }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText('Perfil'), 'compact');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('detalle')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ period: '2027-1', alternatives_requested: 4, optimization_profile: 'compact', time_limit_seconds: 120 });
    expect(post.headers).toMatchObject({ 'x-actor': 'coordinacion@unbosque.edu.co', 'x-roles': 'COORDINATOR' });
  });

  it('muestra el error de validación de la API', async () => {
    mockApi({
      'GET /v1/schedule-requests': [],
      'GET /v1/academic-periods': [{ id: 'p', code: '2027-1' }],
      'POST /v1/schedule-requests': () => new Response(JSON.stringify({ message: 'No hay grupos para el período' }), { status: 400 }),
    });
    renderAt('/', [{ path: '/', element: <RequestsPage /> }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay grupos para el período');
  });
});
