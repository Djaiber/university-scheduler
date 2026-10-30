import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AlternativeDetail, Assignment, Change, Revision } from '@us/api-client';
import { StatusBadge } from '../components/StatusBadge';
import { Timetable } from '../components/Timetable';
import { hasRole, useSession } from '../session';

type FilterKind = 'cohort' | 'teacher' | 'room';

/** Editor de una alternativa: seleccionar una sesión, moverla de franja/aula, ver la revalidación y guardar. */
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

  async function stage(change: Change) {
    const next = [...pending.filter((c) => !(c.group === change.group && c.session === change.session)), change];
    setPending(next);
    setPreview(await api.previewChanges(id, next));
  }

  async function save() {
    if (!alt?.revision) return;
    try {
      const rev = await api.createRevision(id, { base_revision_id: alt.revision.id, changes: pending, reason });
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

  const canEdit = hasRole(session, 'COORDINATOR') && ['PENDING_REVIEW', 'NEEDS_ADJUSTMENTS', 'PENDING_APPROVAL', 'APPROVED'].includes(alt.request_status);
  const options = [...new Set(alt.assignments.map((a) => (filter.kind === 'cohort' ? a.cohort : filter.kind === 'teacher' ? a.teacher : a.room)))].sort();

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
        {message && <p className={message.kind === 'error' ? 'error' : 'badge ok'} role="alert">{message.text}</p>}
      </section>

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
          {canEdit && <span className="muted">Seleccione una sesión y luego la franja destino.</span>}
        </div>
        <Timetable
          assignments={shown}
          slots={alt.context.slots}
          filter={filter.value ? filter : null}
          selected={selected ? `${selected.group}#${selected.session}` : null}
          violating={violating}
          onSelect={(_k, a) => canEdit && setSelected(a)}
          onSlotClick={(slot) => selected && canEdit && void stage({ group: selected.group, session: selected.session, slot, room: selected.room })}
        />
        {selected && canEdit && (
          <div className="row" style={{ marginTop: 12 }}>
            <strong>{selected.group} · sesión {selected.session + 1}</strong>
            <label>Aula
              <select aria-label="Aula" value={shown.find((a) => a.group === selected.group && a.session === selected.session)?.room}
                onChange={(e) => {
                  const cur = shown.find((a) => a.group === selected.group && a.session === selected.session)!;
                  void stage({ group: cur.group, session: cur.session, slot: cur.slot, room: e.target.value });
                }}>
                {alt.context.rooms.map((r) => <option key={r.id} value={r.id}>{r.id} ({r.capacity})</option>)}
              </select>
            </label>
          </div>
        )}
      </section>

      {validation && validation.hard_violations.length > 0 && (
        <section className="panel">
          <h3>Violaciones duras {preview ? '(con los cambios pendientes)' : ''}</h3>
          <ul>{validation.hard_violations.map((v, i) => <li key={i}><strong>{v.rule}</strong>: {v.message}</li>)}</ul>
        </section>
      )}

      {pending.length > 0 && (
        <section className="panel">
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
