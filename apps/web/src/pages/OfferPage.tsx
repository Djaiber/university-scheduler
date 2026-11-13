import { useCallback, useEffect, useState } from 'react';
import type { Offers, OfferState } from '@us/api-client';
import { PeriodSelect } from '../components/PeriodSelect';
import { usePeriods } from '../hooks/usePeriods';
import { hasRole, useSession } from '../session';

const LABEL: Record<OfferState, [string, string]> = {
  SIN_CONSOLIDAR: ['Sin consolidar', 'warn'],
  CONSOLIDADA: ['Consolidada', 'ok'],
  DESACTUALIZADA: ['Cambió tras consolidar', 'bad'],
};

export function OfferStateBadge({ state }: { state: OfferState }) {
  const [text, tone] = LABEL[state];
  return <span className={`badge ${tone}`}>{text}</span>;
}

/**
 * Oferta académica (SCRUM-45). El DIRECTOR revisa los grupos de su programa y consolida la oferta:
 * es el visto bueno que habilita al administrador para generar. Si la oferta cambia, hay que reconsolidar.
 */
export function OfferPage() {
  const { api, session, me } = useSession();
  const { periods, period, setPeriod } = usePeriods();
  const [data, setData] = useState<Offers | null>(null);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const isDirector = hasRole(session, 'DIRECTOR');

  const load = useCallback(async () => {
    if (period) setData(await api.offers(period));
  }, [api, period]);
  useEffect(() => { load().catch((e: Error) => setMsg({ kind: 'error', text: e.message })); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      setNotes('');
      setReason('');
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const own = data?.programs.find((p) => p.program === me?.program) ?? (isDirector ? data?.programs[0] : undefined);

  return (
    <>
      <section className="panel">
        <p className="eyebrow">{isDirector ? `Director · ${me?.program ?? 'sin programa asignado'}` : 'Oferta por programa'}</p>
        <h2>Consolidar oferta</h2>
        <div className="row"><PeriodSelect periods={periods} value={period} onChange={setPeriod} /></div>
        {msg && <p className={msg.kind === 'error' ? 'error' : 'success'} role="alert">{msg.text}</p>}
      </section>

      {data && !isDirector && (
        <section className="panel">
          <table aria-label="Estado de la oferta">
            <thead><tr><th>Programa</th><th>Grupos</th><th>Estado</th><th>Consolidó</th><th>Notas</th></tr></thead>
            <tbody>
              {data.programs.map((p) => (
                <tr key={p.program}>
                  <td>{p.program}</td><td>{p.groups}</td><td><OfferStateBadge state={p.state} /></td>
                  <td>{p.consolidation ? `${p.consolidation.consolidated_by} · ${new Date(p.consolidation.consolidated_at).toLocaleString('es-CO')}` : '—'}</td>
                  <td>{p.consolidation?.notes ?? ''}</td>
                </tr>
              ))}
              {data.programs.length === 0 && <tr><td colSpan={5} className="muted">No hay grupos cargados en el período.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {data && isDirector && (
        <>
          <section className="panel accent">
            {own ? (
              <>
                <h3>{own.program} · {own.groups} grupos <OfferStateBadge state={own.state} /></h3>
                {own.consolidation && <p className="muted">Consolidada por {own.consolidation.consolidated_by} el {new Date(own.consolidation.consolidated_at).toLocaleString('es-CO')}{own.consolidation.notes ? ` · ${own.consolidation.notes}` : ''}</p>}
                {own.state === 'DESACTUALIZADA' && <p className="notice">La oferta cambió después de consolidarla. Revísela y vuelva a consolidar para habilitar la generación.</p>}
                {own.state !== 'CONSOLIDADA' ? (
                  <div className="row">
                    <label style={{ flex: 1 }}>Notas para el administrador
                      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. cupos confirmados con coordinación" />
                    </label>
                    <button onClick={() => void run(() => api.consolidateOffer(period, notes || undefined), 'Oferta consolidada: el administrador ya puede generar.')}>Consolidar oferta</button>
                  </div>
                ) : (
                  <div className="row">
                    <label style={{ flex: 1 }}>Motivo para reabrir
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="p. ej. se abre un grupo adicional" />
                    </label>
                    <button className="secondary" disabled={reason.trim().length < 5}
                      onClick={() => void run(() => api.reopenOffer(period, reason), 'Oferta reabierta.')}>Reabrir</button>
                  </div>
                )}
              </>
            ) : <p className="muted">Su programa no tiene grupos cargados en este período.</p>}
          </section>

          {data.groups && data.groups.length > 0 && (
            <section className="panel">
              <h3>Grupos ofertados</h3>
              <table aria-label="Grupos ofertados">
                <thead><tr><th>Grupo</th><th>Asignatura</th><th>Docente</th><th>Cohorte</th><th>Cupo</th><th>Sesiones</th><th>Requiere</th></tr></thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.code}>
                      <td>{g.code}</td><td>{g.course_name} <span className="muted">({g.course})</span></td><td>{g.teacher_name}</td>
                      <td>{g.cohort}</td><td>{g.size}</td><td>{g.sessions_per_week}</td><td>{g.required_features.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
