import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Adjustment } from '@us/api-client';
import { PriorityBadge } from '../components/AdjustmentsPanel';
import { hasRole, useSession } from '../session';

/** Todas las solicitudes de ajuste (del programa del director, o de todos para el personal). */
export function AdjustmentsPage() {
  const { api, session } = useSession();
  const [items, setItems] = useState<Adjustment[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.listAdjustments().then(setItems).catch((e: Error) => setError(e.message)); }, [api]);
  const director = hasRole(session, 'DIRECTOR') && !hasRole(session, 'ADMINISTRADOR', 'COMITE_TACTICO');

  return (
    <section className="panel">
      <p className="eyebrow">{director ? 'Director' : 'Administrador'}</p>
      <h2>Ajustes priorizados</h2>
      <p className="muted">
        {director
          ? 'Registre y priorice ajustes desde la alternativa de horario correspondiente; el administrador los atiende en orden de prioridad.'
          : 'Atienda los ajustes desde la alternativa: arrastre la sesión, guarde la revisión y márquelo como resuelto.'}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <table aria-label="Ajustes">
        <thead><tr><th>Prioridad</th><th>Estado</th><th>Programa</th><th>Grupo</th><th>Ajuste</th><th>Solicitó</th><th>Resolución</th><th /></tr></thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id}>
              <td><PriorityBadge priority={a.priority} /></td>
              <td><span className={`badge ${a.status === 'ABIERTA' ? 'warn' : a.status === 'RESUELTA' ? 'ok' : ''}`}>{a.status}</span></td>
              <td>{a.program}</td>
              <td>{a.group_code ?? '—'}</td>
              <td>{a.description}</td>
              <td>{a.created_by}<div className="muted">{new Date(a.created_at).toLocaleString('es-CO')}</div></td>
              <td>{a.resolution ?? '—'}{a.revision_no !== null && <div className="muted">revisión {a.revision_no}</div>}</td>
              <td><Link to={`/requests/${a.schedule_request_id}`}>Solicitud →</Link></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={8} className="muted">No hay solicitudes de ajuste.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
