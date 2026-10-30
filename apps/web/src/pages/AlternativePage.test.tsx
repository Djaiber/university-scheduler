import { screen, waitFor, within } from '@testing-library/react';
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

describe('AlternativePage (edición manual)', () => {
  beforeEach(() => localStorage.clear());

  it('mueve una sesión, muestra la revalidación y guarda una revisión con motivo', async () => {
    const clash = { valid: false, soft_penalty: 4, soft_breakdown: {}, hard_violations: [{ rule: 'H4_COHORT_CLASH', message: 'La cohorte K1 tiene 2 sesiones en MON-1', entities: ['K1', 'MON-1', 'G1', 'G2'] }] };
    const { calls } = mockApi({
      'GET /v1/alternatives/:id': detail(),
      'GET /v1/alternatives/:id/revisions': [{ id: 'rev0', revision_no: 0, created_by: 'optimizer', reason: 'Salida del motor', hard_violations: 0, soft_penalty: 4, created_at: '2026-10-30T10:00:00Z' }],
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

  it('no permite editar sin rol de coordinación', async () => {
    localStorage.setItem('scheduler.session', JSON.stringify({ actor: 'rev', roles: ['REVIEWER'], token: null }));
    mockApi({ 'GET /v1/alternatives/:id': detail(), 'GET /v1/alternatives/:id/revisions': [] });
    renderAt('/alternatives/alt1', [{ path: '/alternatives/:id', element: <AlternativePage /> }]);
    const grid = await screen.findByRole('table', { name: 'Horario semanal' });
    await userEvent.click(within(grid).getByText('CAL1 · R1'));
    await waitFor(() => expect(screen.queryByLabelText('Aula')).not.toBeInTheDocument());
  });
});
