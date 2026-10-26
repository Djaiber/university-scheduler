import { Link, useParams } from 'react-router-dom';
import type { ScheduleRequestDetail } from '@us/api-client';
import type { JobStatus } from '@us/shared-types';
import { StatusBadge } from '../components/StatusBadge';
import { usePolling } from '../hooks/usePolling';
import { useSession } from '../session';

const IN_PROGRESS: JobStatus[] = ['QUEUED', 'SOLVING', 'VALIDATING'];

export function RequestDetailPage({ pollMs = 3000 }: { pollMs?: number }) {
  const { id = '' } = useParams();
  const { api } = useSession();
  const { data, error } = usePolling<ScheduleRequestDetail>(
    () => api.getRequest(id), pollMs, (d) => IN_PROGRESS.includes(d.status), [id, api],
  );

  if (error) return <p className="error" role="alert">{error.message}</p>;
  if (!data) return <p className="muted">Cargando…</p>;

  const run = data.runs.at(-1);
  const precheck = run?.diagnostics?.precheck ?? [];

  return (
    <>
      <section className="panel">
        <p><Link to="/">← Solicitudes</Link></p>
        <h2>Solicitud {data.period} <StatusBadge status={data.status} /></h2>
        <p className="muted">
          {data.alternatives_requested} alternativas · perfil {data.optimization_profile} · límite {data.time_limit_seconds}s ·
          snapshot <code>{data.snapshot_sha256.slice(0, 12)}</code> · solicitó {data.requested_by}
        </p>
        {IN_PROGRESS.includes(data.status) && <p role="status">Generando alternativas… esta página se actualiza sola.</p>}
        {run?.error && (
          <p className="error" role="alert">Error {run.error.code}: {run.error.message}
            {run.solver_status === 'TIMEOUT' && ' — no se encontró solución en el tiempo dado; esto no prueba que sea imposible.'}</p>
        )}
        {precheck.length > 0 && (
          <div role="alert">
            <h3>Por qué no hay solución</h3>
            <ul>{precheck.map((p, i) => <li key={i}><strong>{p.rule}</strong>: {p.message}</li>)}</ul>
          </div>
        )}
      </section>

      {data.alternatives.length > 0 && (
        <section className="panel">
          <h2>Alternativas</h2>
          <p><Link to={`/requests/${data.id}/compare`}>Comparar lado a lado →</Link></p>
          <table>
            <thead><tr><th>#</th><th>Perfil</th><th>Estado del solver</th><th>Penalización</th><th>Violaciones duras</th></tr></thead>
            <tbody>
              {data.alternatives.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/alternatives/${a.id}`}>Alternativa {a.ordinal}</Link></td>
                  <td>{a.profile}</td>
                  <td>{a.solver_status}</td>
                  <td>{a.soft_penalty}</td>
                  <td>{a.hard_violations === 0 ? <span className="badge ok">0</span> : <span className="badge bad">{a.hard_violations}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
