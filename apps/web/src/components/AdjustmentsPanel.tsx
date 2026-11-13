import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { Adjustment, AdjustmentPriority } from '@us/api-client';
import { hasRole, useSession } from '../session';

const PRIORITIES: AdjustmentPriority[] = ['ALTA', 'MEDIA', 'BAJA'];

export function PriorityBadge({ priority }: { priority: AdjustmentPriority }) {
  return <span className={`badge prio-${priority}`}>{priority}</span>;
}

/**
 * Cola de ajustes priorizados de una solicitud (SCRUM-45).
 * - DIRECTOR: registra ajustes y cambia su prioridad mientras están abiertos.
 * - ADMINISTRADOR: los atiende en el editor y los cierra (resuelta con la última revisión guardada, o rechazada).
 * - COMITÉ TÁCTICO: solo lectura, como contexto para evaluar.
 */
export function AdjustmentsPanel({ requestId, groups, lastRevision }: {
  requestId: string;
  groups: string[];
  lastRevision?: { id: string; revision_no: number } | null;
}) {
  const { api, session } = useSession();
  const [items, setItems] = useState<Adjustment[]>([]);
  const [form, setForm] = useState({ group_code: '', description: '', priority: 'MEDIA' as AdjustmentPriority });
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const isDirector = hasRole(session, 'DIRECTOR');
  const isAdmin = hasRole(session, 'ADMINISTRADOR');

  const load = useCallback(() => api.listAdjustments(requestId).then(setItems).catch((e: Error) => setError(e.message)), [api, requestId]);
  useEffect(() => { void load(); }, [load, lastRevision?.id]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await api.createAdjustment({ schedule_request_id: requestId, description: form.description, priority: form.priority,
        ...(form.group_code ? { group_code: form.group_code } : {}) });
      setForm({ group_code: '', description: '', priority: 'MEDIA' });
    });
  }

  const open = items.filter((a) => a.status === 'ABIERTA');
  const closed = items.filter((a) => a.status !== 'ABIERTA');

  return (
    <section className="panel accent" aria-label="Ajustes priorizados">
      <p className="eyebrow">Ajustes priorizados</p>
      <h3>{open.length} abiertos</h3>
      {open.length === 0 && <p className="muted">No hay ajustes pendientes.</p>}
      <ol style={{ paddingLeft: 18, margin: 0 }}>
        {open.map((a) => (
          <li key={a.id} style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems: 'center', gap: 6 }}>
              <PriorityBadge priority={a.priority} />
              {a.group_code && <strong>{a.group_code}</strong>}
              <span className="muted">{a.program} · {a.created_by}</span>
            </div>
            <div>{a.description}</div>
            {isDirector && (
              <label className="inline">Prioridad
                <select aria-label={`Prioridad de ${a.group_code ?? a.description.slice(0, 20)}`} value={a.priority}
                  onChange={(e) => void run(() => api.prioritizeAdjustment(a.id, e.target.value as AdjustmentPriority))}>
                  {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
            )}
            {isAdmin && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="secondary" disabled={!lastRevision}
                  title={lastRevision ? '' : 'Guarde primero una revisión con el ajuste'}
                  onClick={() => void run(() => api.resolveAdjustment(a.id, { status: 'RESUELTA', revision_id: lastRevision!.id,
                    resolution: `Atendido en la revisión ${lastRevision!.revision_no}` }))}>
                  {lastRevision ? `Resuelto en rev. ${lastRevision.revision_no}` : 'Resolver'}
                </button>
                {rejecting?.id !== a.id && <button className="link" onClick={() => setRejecting({ id: a.id, reason: '' })}>Rechazar</button>}
              </div>
            )}
            {isAdmin && rejecting?.id === a.id && (
              <div className="row" style={{ marginTop: 6 }}>
                <input aria-label="Motivo del rechazo" placeholder="Motivo del rechazo" value={rejecting.reason}
                  onChange={(e) => setRejecting({ id: a.id, reason: e.target.value })} />
                <button className="danger" disabled={rejecting.reason.trim().length < 5}
                  onClick={() => void run(async () => {
                    await api.resolveAdjustment(a.id, { status: 'RECHAZADA', resolution: rejecting.reason.trim() });
                    setRejecting(null);
                  })}>Confirmar</button>
                <button className="link" onClick={() => setRejecting(null)}>Cancelar</button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {isDirector && (
        <form onSubmit={submit} aria-label="Solicitar ajuste" style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <label>Grupo (opcional)
            <select value={form.group_code} onChange={(e) => setForm({ ...form, group_code: e.target.value })}>
              <option value="">— General —</option>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label>Ajuste solicitado
            <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="p. ej. mover C101-A: el docente tiene clínica los lunes" />
          </label>
          <label>Prioridad
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as AdjustmentPriority })}>
              {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <button type="submit" disabled={form.description.trim().length < 10}>Solicitar ajuste</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {closed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">{closed.length} cerrados</summary>
          <ul>
            {closed.map((a) => (
              <li key={a.id}><span className={`badge ${a.status === 'RESUELTA' ? 'ok' : ''}`}>{a.status}</span> {a.group_code ?? ''} {a.description}
                <div className="muted">{a.resolution}{a.revision_no !== null ? ` · rev. ${a.revision_no}` : ''} · {a.resolved_by}</div></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
