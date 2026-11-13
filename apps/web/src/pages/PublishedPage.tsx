import { useEffect, useState } from 'react';
import type { PublishedSchedule } from '@us/api-client';
import { PeriodSelect } from '../components/PeriodSelect';
import { WeekSchedule } from '../components/WeekSchedule';
import { usePeriods } from '../hooks/usePeriods';
import { hasRole, useSession } from '../session';

/**
 * Horario publicado. `mine` = horario del DOCENTE autenticado; si no, consulta por programa y cohorte
 * (el ESTUDIANTE queda limitado a su programa y, por defecto, a su cohorte).
 */
export function PublishedPage({ mine = false }: { mine?: boolean }) {
  const { api, session, me } = useSession();
  const { periods, period, setPeriod } = usePeriods();
  const [cohort, setCohort] = useState('');
  const [data, setData] = useState<PublishedSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studentOnly = hasRole(session, 'ESTUDIANTE') && !hasRole(session, 'ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR', 'DOCENTE');

  useEffect(() => {
    if (!period) return;
    setError(null);
    (mine ? api.mySchedule(period) : api.publishedSchedule(period, { cohort: cohort || undefined }))
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [api, period, cohort, mine]);

  return (
    <>
      <section className="panel">
        <p className="eyebrow">{mine ? 'Docente' : studentOnly ? `Estudiante · ${me?.program ?? ''}` : 'Consulta'}</p>
        <h2>{mine ? 'Mi horario' : 'Horario publicado'}</h2>
        <div className="row">
          <PeriodSelect periods={periods} value={period} onChange={setPeriod} />
          {!mine && (data?.cohorts?.length ?? 0) > 0 && (
            <label>Cohorte
              <select aria-label="Cohorte" value={cohort} onChange={(e) => setCohort(e.target.value)}>
                <option value="">{studentOnly && me?.cohort ? `Mi cohorte (${me.cohort})` : 'Todas'}</option>
                {data!.cohorts!.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
        {data?.publication
          ? <p className="muted">Publicado el {new Date(data.publication.published_at).toLocaleString('es-CO')} · revisión {data.publication.revision_no} · {data.sessions.length} sesiones</p>
          : data && <p className="notice">Aún no hay un horario publicado para {data.period}.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {data?.publication && data.sessions.length > 0 && (
        <section className="panel">
          <WeekSchedule slots={data.slots} sessions={data.sessions} show={mine ? 'teacher' : 'cohort'} />
        </section>
      )}
    </>
  );
}
