import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AlternativeDetail, Assignment, Change, Revision } from '@us/api-client';
import { AdjustmentsPanel } from '../components/AdjustmentsPanel';
import { GovernancePanel } from '../components/GovernancePanel';
import { StatusBadge } from '../components/StatusBadge';
import { Timetable } from '../components/Timetable';
import { hasRole, useSession } from '../session';

type FilterKind = 'cohort' | 'teacher' | 'room';
const EDITABLE = ['PENDING_REVIEW', 'NEEDS_ADJUSTMENTS', 'PENDING_APPROVAL', 'APPROVED'];

/**
 * Alternativa de horario. El ADMINISTRADOR la ajusta arrastrando sesiones (drag-and-drop) con revalidación
 * inmediata y guarda una revisión con motivo; el resto de actores la ve en solo lectura.
 */
export function AlternativePage() {
  const { id = '' } = useParams();
  const { api, session } = useSession();
  const [alt, setAlt] = useState<AlternativeDetail | null>(null);
  const [history, setHistory] = useState<Omit<Revision, 'validation'>[]>([]);
  const [filter, setFilter] = useState<{ kind: FilterKind; value: string }>({ kind: 'cohort', value: '' });
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [pending, setPending] = useState<Change[]>([]);
  const [preview, setPreview] = useState<Revision['validation'] | null>(null);
  const [reason, setReason] = useState('');
  const [lastSaved, setLastSaved] = useState<{ id: string; revision_no: number } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const a = await api.getAlternative(id);
    setAlt(a);
    setHistory(await api.listRevisions(id));
    setFilter((f) => (f.value ? f : { kind: 'cohort', value: a.assignments[0]?.cohort ?? '' }));
  }, [api, id]);

  useEffect(() => {
    load().catch((e: Error) => setMessage({ kind: 'error', text: e.message }));
  }, [load]);

  // Asignaciones mostradas = revisión vigente + cambios pendientes
  const shown = useMemo(() => {
    if (!alt) return [];
    const byKey = new Map(alt.assignments.map((a) => [`${a.group}#${a.session}`, a]));
    for (const c of pending) {
      const cur = byKey.get(`${c.group}#${c.session}`);
      if (cur) byKey.set(`${c.group}#${c.session}`, { ...cur, slot: c.slot, room: c.room });
    }
    return [...byKey.values()];
  }, [alt, pending]);

  const validation = preview ?? alt?.revision?.validation ?? null;
  const violating = useMemo(
    () => new Set((validation?.hard_violations ?? []).flatMap((v) => shown.filter((a) => v.entities.includes(a.group)).map((a) => `${a.group}#${a.session}`))),
    [validation, shown],
  );
  const pendingKeys = useMemo(() => new Set(pending.map((c) => `${c.group}#${c.session}`)), [pending]);

  async function stage(change: Change) {
    const next = [...pending.filter((c) => !(c.group === change.group && c.session === change.session)), change];
    setPending(next);
    setMessage(null);
    try {
      setPreview(await api.previewChanges(id, next));
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  async function save() {
    if (!alt?.revision) return;
    try {
      const rev = await api.createRevision(id, { base_revision_id: alt.revision.id, changes: pending, reason });
      setLastSaved({ id: rev.id, revision_no: rev.revision_no });
      setMessage(rev.validation.valid
        ? { kind: 'ok', text: `Revisión ${rev.revision_no} guardada y válida.` }
        : { kind: 'error', text: `Revisión ${rev.revision_no} guardada con ${rev.validation.hard_violations.length} violaciones duras: no podrá aprobarse.` });
      setPending([]);
      setPreview(null);
      setReason('');
      setSelected(null);
      await load();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  if (!alt) return message ? <p className="error" role="alert">{message.text}</p> : <p className="muted">Cargando…</p>;

  const isAdmin = hasRole(session, 'ADMINISTRADOR');
  const canEdit = isAdmin && EDITABLE.includes(alt.request_status);
  const showAdjustments = hasRole(session, 'ADMINISTRADOR', 'DIRECTOR', 'COMITE_TACTICO');
  const options = [...new Set(alt.assignments.map((a) => (filter.kind === 'cohort' ? a.cohort : filter.kind === 'teacher' ? a.teacher : a.room)))].sort();
  const current = selected && shown.find((a) => a.group === selected.group && a.session === selected.session);

  return (
    <>
      <section className="panel">
        <p><Link to={`/requests/${alt.request_id}`}>← Solicitud</Link></p>
        <h2>Alternativa {alt.ordinal} · {alt.profile} <StatusBadge status={alt.request_status} /></h2>
        <p className="muted">
          Revisión {alt.revision?.revision_no} por {alt.revision?.created_by} · hash <code>{alt.revision?.content_sha256.slice(0, 12)}</code> ·
          penalización {validation?.soft_penalty} ·{' '}
          {validation?.valid ? <span className="badge ok">sin violaciones duras</span> : <span className="badge bad">{validation?.hard_violations.length} violaciones duras</span>}
        </p>
        {message && <p className={message.kind === 'error' ? 'error' : 'success'} role="alert">{message.text}</p>}
      </section>

      <div className={showAdjustments ? 'split' : undefined}>
        <div>
          <section className="panel">
            <div className="row">
              <label>Ver por
                <select value={filter.kind} onChange={(e) => setFilter({ kind: e.target.value as FilterKind, value: '' })}>
                  <option value="cohort">Cohorte</option><option value="teacher">Docente</option><option value="room">Aula</option>
                </select>
              </label>
              <label>Valor
                <select aria-label="Valor del filtro" value={filter.value} onChange={(e) => setFilter({ ...filter, value: e.target.value })}>
                  <option value="">Todos</option>
                  {options.map((o) => <option key={o}>{o}</option>)}
                </select>
              </label>
              {canEdit
                ? <span className="muted">Arrastre una sesión a otra franja, o selecciónela y elija la franja destino. Cada cambio se revalida al instante.</span>
                : <span className="chip">Solo lectura{isAdmin ? '' : ' · los ajustes los hace el Administrador'}</span>}
            </div>
            {canEdit && (
              <div className="legend" aria-hidden>
                <span><i style={{ background: 'var(--green-soft)', borderLeft: '3px solid var(--green)' }} />asignada</span>
                <span><i style={{ background: 'var(--peach-soft)', borderLeft: '3px solid var(--orange)' }} />movida sin guardar</span>
                <span><i style={{ background: '#fde8e6', borderLeft: '3px solid var(--bad)' }} />con violación</span>
              </div>
            )}
            <Timetable
              assignments={shown}
              slots={alt.context.slots}
              filter={filter.value ? filter : null}
              selected={selected ? `${selected.group}#${selected.session}` : null}
              violating={violating}
              pending={pendingKeys}
              onSelect={canEdit ? (_k, a) => setSelected(a) : undefined}
              onSlotClick={canEdit ? (slot) => { if (current) void stage({ group: current.group, session: current.session, slot, room: current.room }); } : undefined}
              onDropSession={canEdit ? (a, slot) => void stage({ group: a.group, session: a.session, slot, room: a.room }) : undefined}
            />
            {current && canEdit && (
              <div className="row" style={{ marginTop: 12 }}>
                <strong>{current.group} · sesión {current.session + 1} · {current.slot}</strong>
                <label>Aula
                  <select aria-label="Aula" value={current.room}
                    onChange={(e) => void stage({ group: current.group, session: current.session, slot: current.slot, room: e.target.value })}>
                    {alt.context.rooms.map((r) => <option key={r.id} value={r.id}>{r.id} ({r.capacity})</option>)}
                  </select>
                </label>
                <button className="link" onClick={() => setSelected(null)}>Quitar selección</button>
              </div>
            )}
          </section>

          {pending.length > 0 && (
            <section className="panel accent">
              <h3>Cambios pendientes ({pending.length})</h3>
              <ul>{pending.map((c) => <li key={`${c.group}#${c.session}`}>{c.group} sesión {c.session + 1} → {c.slot} / {c.room}</li>)}</ul>
              <div className="row">
                <label style={{ flex: 1 }}>Motivo (obligatorio)
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. el docente pidió mover su clase" />
                </label>
                <button onClick={() => void save()} disabled={reason.trim().length < 5}>Guardar revisión</button>
                <button className="secondary" onClick={() => { setPending([]); setPreview(null); }}>Descartar</button>
              </div>
            </section>
          )}

          {validation && validation.hard_violations.length > 0 && (
            <section className="panel">
              <h3>Violaciones duras {preview ? '(con los cambios pendientes)' : ''}</h3>
              <ul>{validation.hard_violations.map((v, i) => <li key={i}><strong>{v.rule}</strong>: {v.message}</li>)}</ul>
            </section>
          )}

          {pending.length === 0 && <GovernancePanel alt={alt} onChange={() => void load()} />}
        </div>

        {showAdjustments && (
          <aside>
            <AdjustmentsPanel requestId={alt.request_id} groups={[...new Set(alt.assignments.map((a) => a.group))].sort()}
              lastRevision={lastSaved} />
          </aside>
        )}
      </div>

      <section className="panel">
        <h3>Historial de revisiones</h3>
        <table>
          <thead><tr><th>#</th><th>Autor</th><th>Motivo</th><th>Violaciones</th><th>Penalización</th><th>Fecha</th></tr></thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id}>
                <td>{r.revision_no}</td><td>{r.created_by}</td><td>{r.reason}</td>
                <td>{r.hard_violations}</td><td>{r.soft_penalty}</td><td>{new Date(r.created_at).toLocaleString('es-CO')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
