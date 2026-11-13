import { useEffect, useState } from 'react';
import type { AlternativeDetail, GovernanceSummary } from '@us/api-client';
import { hasRole, useSession } from '../session';

/**
 * Acciones de gobierno según actor y estado (§11, SCRUM-43): el COMITÉ TÁCTICO evalúa (envía a aprobación o
 * pide ajustes) y aprueba; el ADMINISTRADOR publica lo aprobado.
 */
export function GovernancePanel({ alt, onChange }: { alt: AlternativeDetail; onChange: () => void }) {
  const { api, session } = useSession();
  const [gov, setGov] = useState<GovernanceSummary | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.governance(alt.request_id).then(setGov).catch(() => setGov(null));
  }, [api, alt.request_id, alt.revision?.id, alt.request_status]);

  const rev = alt.revision;
  if (!rev) return null;
  const st = alt.request_status;
  const activeApproval = gov?.approvals.find((a) => a.revision_id === rev.id && !a.revoked_at);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setComment('');
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel" aria-label="Gobierno">
      <p className="eyebrow">Comité táctico</p>
      <h3>Evaluación y aprobación</h3>
      <p className="muted">
        Se aprueba la revisión exacta {rev.revision_no} (hash <code>{rev.content_sha256.slice(0, 12)}</code>). Cualquier cambio posterior
        crea otra revisión y revoca la aprobación.
      </p>
      <div className="row">
        <label style={{ flex: 1 }}>Comentario
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Observaciones para el registro" />
        </label>
        {hasRole(session, 'COMITE_TACTICO') && ['PENDING_REVIEW', 'NEEDS_ADJUSTMENTS'].includes(st) && (
          <>
            <button disabled={rev.hard_violations > 0} title={rev.hard_violations > 0 ? 'Tiene violaciones duras' : ''}
              onClick={() => void run(() => api.review(rev.id, 'SEND_TO_APPROVAL', comment || undefined))}>Enviar a aprobación</button>
            {st === 'PENDING_REVIEW' && (
              <button className="secondary" disabled={comment.trim().length < 5}
                onClick={() => void run(() => api.review(rev.id, 'REQUEST_CHANGES', comment))}>Solicitar ajustes</button>
            )}
          </>
        )}
        {hasRole(session, 'COMITE_TACTICO') && st === 'PENDING_APPROVAL' && (
          <button onClick={() => void run(() => api.approve(rev.id, comment || undefined))}>Aprobar revisión {rev.revision_no}</button>
        )}
        {hasRole(session, 'ADMINISTRADOR') && st === 'APPROVED' && activeApproval && (
          <button onClick={() => void run(() => api.publish(activeApproval.id))}>Publicar</button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {gov && (gov.reviews.length > 0 || gov.approvals.length > 0) && (
        <table aria-label="Trazabilidad de gobierno" style={{ marginTop: 12 }}>
          <thead><tr><th>Fecha</th><th>Acción</th><th>Revisión</th><th>Usuario</th><th>Detalle</th></tr></thead>
          <tbody>
            {[
              ...gov.reviews.map((r) => ({ at: r.created_at, what: r.decision === 'SEND_TO_APPROVAL' ? 'Enviada a aprobación' : 'Ajustes solicitados', rev: r.revision_no, who: r.reviewer, detail: r.comment ?? '' })),
              ...gov.approvals.map((a) => ({ at: a.approved_at, what: a.revoked_at ? 'Aprobación revocada' : 'Aprobada', rev: a.revision_no, who: a.approved_by, detail: a.revoke_reason ?? '' })),
              ...gov.publications.map((p) => ({ at: p.published_at, what: 'Publicada', rev: activeApproval?.revision_no ?? rev.revision_no, who: p.published_by, detail: p.export_uri ?? '' })),
            ].sort((x, y) => x.at.localeCompare(y.at)).map((e, i) => (
              <tr key={i}><td>{new Date(e.at).toLocaleString('es-CO')}</td><td>{e.what}</td><td>{e.rev}</td><td>{e.who}</td><td>{e.detail}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
