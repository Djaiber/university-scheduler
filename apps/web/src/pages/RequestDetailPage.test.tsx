import { screen } from '@testing-library/react';
import { RequestDetailPage } from './RequestDetailPage';
import { mockApi, renderAt } from '../test-utils';

const base = { id: 'r1', period: '2027-1', alternatives_requested: 4, optimization_profile: 'balanced', time_limit_seconds: 120,
  requested_by: 'ana', created_at: '', snapshot_sha256: 'abcdef1234567890', alternatives: [] };

describe('RequestDetailPage', () => {
  it('sondea mientras resuelve y muestra las alternativas al terminar', async () => {
    let n = 0;
    mockApi({
      'GET /v1/schedule-requests/:id': () => (++n < 2
        ? { ...base, status: 'SOLVING', runs: [{ status: 'SOLVING', diagnostics: null, error: null }] }
        : { ...base, status: 'PENDING_REVIEW', runs: [{ status: 'PENDING_REVIEW', diagnostics: {}, error: null }],
            alternatives: [{ id: 'a1', ordinal: 1, profile: 'balanced', solver_status: 'OPTIMAL', soft_penalty: 44, hard_violations: 0 }] }),
    });
    renderAt('/requests/r1', [{ path: '/requests/:id', element: <RequestDetailPage pollMs={10} /> }]);
    expect(await screen.findByRole('status')).toHaveTextContent('Generando alternativas');
    expect(await screen.findByText('Alternativa 1')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
    expect(n).toBe(2);
  });

  it('explica por qué no hay solución', async () => {
    mockApi({
      'GET /v1/schedule-requests/:id': { ...base, status: 'INFEASIBLE', runs: [{ status: 'INFEASIBLE', solver_status: 'INFEASIBLE', error: null,
        diagnostics: { precheck: [{ rule: 'TEACHER_OVERLOAD', message: 'T004 tiene 16 sesiones y solo 6 franjas disponibles', entities: [] }] } }] },
    });
    renderAt('/requests/r1', [{ path: '/requests/:id', element: <RequestDetailPage pollMs={10} /> }]);
    expect(await screen.findByText('Sin solución')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('T004 tiene 16 sesiones');
  });

  it('distingue límite de tiempo de inviabilidad', async () => {
    mockApi({
      'GET /v1/schedule-requests/:id': { ...base, status: 'FAILED', runs: [{ status: 'FAILED', solver_status: 'TIMEOUT', diagnostics: {},
        error: { code: 'TIMEOUT', message: 'sin solución en 120 s', retryable: true } }] },
    });
    renderAt('/requests/r1', [{ path: '/requests/:id', element: <RequestDetailPage pollMs={10} /> }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('no prueba que sea imposible');
  });
});
