import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlternativePage } from './AlternativePage';
import { mockApi, renderAt } from '../test-utils';

const slots = [{ id: 'MON-0', day: 1, index: 0 }, { id: 'MON-1', day: 1, index: 1 }, { id: 'TUE-0', day: 2, index: 0 }];
const valid = { valid: true, hard_violations: [], soft_penalty: 4, soft_breakdown: {} };
const detail = (revision_no = 0) => ({
  id: 'alt1', run_id: 'run', request_id: 'req', request_status: 'PENDING_REVIEW', ordinal: 1, profile: 'balanced', period: '2027-1',
  metrics: {}, context: { slots, rooms: [{ id: 'R1', capacity: 40 }, { id: 'R2', capacity: 30 }] },
  revision: { id: `rev${revision_no}`, revision_no, content_sha256: 'abcdef123456789', created_by: 'optimizer', validation: valid },
  assignments: [
    { group: 'G1', session: 0, slot: 'MON-0', room: 'R1', course: 'CAL1', teacher: 'T1', cohort: 'K1' },
    { group: 'G2', session: 0, slot: 'MON-1', room: 'R2', course: 'FIS1', teacher: 'T2', cohort: 'K1' },
  ],
});

const history = [{ id: 'rev0', revision_no: 0, created_by: 'optimizer', reason: 'Salida del motor', hard_violations: 0, soft_penalty: 4, created_at: '2026-10-30T10:00:00Z' }];
const as = (roles: string[]) => localStorage.setItem('scheduler.session', JSON.stringify({ actor: 'u@x.co', roles, token: null }));

describe('AlternativePage (edición manual)', () => {
  beforeEach(() => localStorage.clear());

  it('administrador: arrastra una sesión a otra franja, revalida y resuelve el ajuste priorizado con la revisión', async () => {
    const { calls } = mockApi({
      'GET /v1/alternatives/:id': detail(),
      'GET /v1/alternatives/:id/revisions': history,
      'GET /v1/adjustments': [{ id: 'adj1', schedule_request_id: 'req', program: 'SIS', group_code: 'G1', description: 'Mover G1 del lunes temprano',
        priority: 'ALTA', status: 'ABIERTA', created_by: 'dir', created_at: '2026-11-10T10:00:00Z', resolved_by: null, resolved_at: null,
        resolution: null, revision_id: null, revision_no: null }],
      'POST /v1/alternatives/:id/preview': valid,
      'POST /v1/alternatives/:id/revisions': { id: 'rev1', revision_no: 1, content_sha256: 'x', validation: valid },
      'POST /v1/adjustments/:id/resolve': {},
    });
    renderAt('/alternatives/alt1', [{ path: '/alternatives/:id', element: <AlternativePage /> }]);
    const grid = await screen.findByRole('table', { name: 'Horario semanal' });
    expect(await screen.findByText('Mover G1 del lunes temprano')).toBeInTheDocument();
    const item = within(grid).getByText('CAL1 · R1');
    expect(item).toHaveAttribute('draggable', 'true');

    const target = grid.querySelector('td[data-slot="TUE-0"]')!;
    fireEvent.dragStart(item);
    fireEvent.dragOver(target);
    expect(target).toHaveClass('drop-target');
    fireEvent.drop(target);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/preview'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/preview'))!.body).toEqual({ changes: [{ group: 'G1', session: 0, slot: 'TUE-0', room: 'R1' }] });
    expect(await within(grid.querySelector('td[data-slot="TUE-0"]')!).findByText('CAL1 · R1')).toHaveClass('pending');

    await userEvent.type(screen.getByPlaceholderText(/docente pidió/i), 'Ajuste priorizado por dirección');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar revisión' }));
    expect(await screen.findByText('Revisión 1 guardada y válida.')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Resuelto en rev. 1' }));
    const resolve = calls.find((c) => c.url === '/v1/adjustments/adj1/resolve')!;
    expect(resolve.body).toEqual({ status: 'RESUELTA', revision_id: 'rev1', resolution: 'Atendido en la revisión 1' });
  });

  it('alternativa por teclado/clic: mueve una sesión, muestra la revalidación y guarda una revisión con motivo', async () => {
    const clash = { valid: false, soft_penalty: 4, soft_breakdown: {}, hard_violations: [{ rule: 'H4_COHORT_CLASH', message: 'La cohorte K1 tiene 2 sesiones en MON-1', entities: ['K1', 'MON-1', 'G1', 'G2'] }] };
    const { calls } = mockApi({
      'GET /v1/alternatives/:id': detail(),
      'GET /v1/alternatives/:id/revisions': history,
      'GET /v1/adjustments': [],
      'POST /v1/alternatives/:id/preview': clash,
      'POST /v1/alternatives/:id/revisions': { id: 'rev1', revision_no: 1, content_sha256: 'x', validation: clash },
    });
    renderAt('/alternatives/alt1', [{ path: '/alternatives/:id', element: <AlternativePage /> }]);
    const grid = await screen.findByRole('table', { name: 'Horario semanal' });
    await userEvent.click(within(grid).getByText('CAL1 · R1'));
    await userEvent.click(grid.querySelector('td[data-slot="MON-1"]')!);
    expect(await screen.findByText(/La cohorte K1 tiene 2 sesiones/)).toBeInTheDocument();
    expect(within(grid).getByText('CAL1 · R1')).toHaveClass('violation');

    const save = screen.getByRole('button', { name: 'Guardar revisión' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/motivo|docente pidió/i), 'Docente pidió cambio');
    await userEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('no podrá aprobarse');
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/revisions'))!;
    expect(post.body).toEqual({ base_revision_id: 'rev0', reason: 'Docente pidió cambio', changes: [{ group: 'G1', session: 0, slot: 'MON-1', room: 'R1' }] });
  });

  it.each([['COMITE_TACTICO'], ['DIRECTOR']])('%s: cuadrícula en solo lectura, sin arrastre ni edición', async (role) => {
    as([role]);
    const { calls } = mockApi({ 'GET /v1/alternatives/:id': detail(), 'GET /v1/alternatives/:id/revisions': [], 'GET /v1/adjustments': [],
      'GET /v1/schedule-requests/:id/governance': { reviews: [], approvals: [], publications: [] } });
    renderAt('/alternatives/alt1', [{ path: '/alternatives/:id', element: <AlternativePage /> }]);
    const grid = await screen.findByRole('table', { name: 'Horario semanal' });
    expect(screen.getByText(/Solo lectura · los ajustes los hace el Administrador/)).toBeInTheDocument();
    const item = within(grid).getByText('CAL1 · R1');
    expect(item).not.toHaveAttribute('draggable');
    await userEvent.click(item);
    fireEvent.drop(grid.querySelector('td[data-slot="TUE-0"]')!);
    await waitFor(() => expect(screen.queryByLabelText('Aula')).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.endsWith('/preview'))).toBe(false);
  });

  it('director: registra un ajuste con prioridad para la solicitud', async () => {
    as(['DIRECTOR']);
    const { calls } = mockApi({ 'GET /v1/alternatives/:id': detail(), 'GET /v1/alternatives/:id/revisions': [], 'GET /v1/adjustments': [],
      'GET /v1/schedule-requests/:id/governance': { reviews: [], approvals: [], publications: [] }, 'POST /v1/adjustments': {} });
    renderAt('/alternatives/alt1', [{ path: '/alternatives/:id', element: <AlternativePage /> }]);
    const form = await screen.findByRole('form', { name: 'Solicitar ajuste' });
    await userEvent.selectOptions(within(form).getByLabelText('Grupo (opcional)'), 'G2');
    await userEvent.type(within(form).getByLabelText('Ajuste solicitado'), 'Pasar FIS1 a la tarde por práctica');
    await userEvent.selectOptions(within(form).getByLabelText('Prioridad'), 'ALTA');
    await userEvent.click(within(form).getByRole('button', { name: 'Solicitar ajuste' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      schedule_request_id: 'req', group_code: 'G2', description: 'Pasar FIS1 a la tarde por práctica', priority: 'ALTA' }));
  });
});
