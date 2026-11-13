import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AlternativeDetail } from '@us/api-client';
import { GovernancePanel } from './GovernancePanel';
import { SessionProvider } from '../session';
import { mockApi } from '../test-utils';

const alt = (request_status: string, hard_violations = 0) => ({
  id: 'alt', request_id: 'req', request_status, revision: { id: 'rev2', revision_no: 2, content_sha256: 'abcdef1234567890', hard_violations },
}) as unknown as AlternativeDetail;
const emptyGov = { reviews: [], approvals: [], publications: [] };

function as(roles: string[]) {
  localStorage.setItem('scheduler.session', JSON.stringify({ actor: 'u', roles, token: null }));
}

describe('GovernancePanel', () => {
  beforeEach(() => localStorage.clear());

  it('comité táctico: envía a aprobación; deshabilitado con violaciones duras', async () => {
    as(['COMITE_TACTICO']);
    const { calls } = mockApi({ 'GET /v1/schedule-requests/:id/governance': emptyGov, 'POST /v1/revisions/:id/reviews': {} });
    const onChange = vi.fn();
    const { rerender } = render(<SessionProvider><GovernancePanel alt={alt('PENDING_REVIEW', 2)} onChange={onChange} /></SessionProvider>);
    expect(screen.getByRole('button', { name: 'Enviar a aprobación' })).toBeDisabled();
    rerender(<SessionProvider><GovernancePanel alt={alt('PENDING_REVIEW')} onChange={onChange} /></SessionProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar a aprobación' }));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ decision: 'SEND_TO_APPROVAL' });
    expect(onChange).toHaveBeenCalled();
  });

  it('comité táctico: aprueba solo cuando está pendiente de aprobación y muestra errores de la API', async () => {
    as(['COMITE_TACTICO']);
    mockApi({
      'GET /v1/schedule-requests/:id/governance': emptyGov,
      'POST /v1/revisions/:id/approvals': () => new Response(JSON.stringify({ message: 'Quien edita una revisión no puede aprobarla' }), { status: 409 }),
    });
    render(<SessionProvider><GovernancePanel alt={alt('PENDING_APPROVAL')} onChange={() => undefined} /></SessionProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar revisión 2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no puede aprobarla');
    expect(screen.queryByRole('button', { name: 'Enviar a aprobación' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
  });

  it('administrador: no evalúa ni aprueba', async () => {
    as(['ADMINISTRADOR']);
    mockApi({ 'GET /v1/schedule-requests/:id/governance': emptyGov });
    render(<SessionProvider><GovernancePanel alt={alt('PENDING_APPROVAL')} onChange={() => undefined} /></SessionProvider>);
    expect(screen.queryByRole('button', { name: /Aprobar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar a aprobación' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('pendiente de la decisión del comité táctico');
  });

  it('administrador: publica la aprobación vigente y ve la trazabilidad', async () => {
    as(['ADMINISTRADOR']);
    const { calls } = mockApi({
      'GET /v1/schedule-requests/:id/governance': {
        reviews: [{ id: 'r', revision_id: 'rev2', revision_no: 2, reviewer: 'sec', decision: 'SEND_TO_APPROVAL', comment: 'ok', created_at: '2026-11-06T10:00:00Z' }],
        approvals: [{ id: 'ap1', revision_id: 'rev2', revision_no: 2, approved_by: 'dec', approved_at: '2026-11-07T10:00:00Z', revoked_at: null, revoke_reason: null }],
        publications: [],
      },
      'POST /v1/approvals/:id/publish': { publication_id: 'p', export_uri: null },
    });
    render(<SessionProvider><GovernancePanel alt={alt('APPROVED')} onChange={() => undefined} /></SessionProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    expect(calls.some((c) => c.method === 'POST' && c.url === '/v1/approvals/ap1/publish')).toBe(true);
    expect(screen.getByRole('table', { name: 'Trazabilidad de gobierno' })).toHaveTextContent('Aprobada');
  });
});
