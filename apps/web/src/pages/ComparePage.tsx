import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Comparison, ComparisonItem, SlotInfo } from '@us/api-client';
import { Timetable } from '../components/Timetable';
import { useSession } from '../session';

interface MetricDef {
  label: string;
  value: (a: ComparisonItem) => number;
  better: 'low' | 'high';
  format?: (n: number) => string;
}

const pct = (n: number) => `${Math.round(n * 100)} %`;

export const METRICS: MetricDef[] = [
  { label: 'Violaciones duras', value: (a) => a.revision?.hard_violations ?? 0, better: 'low' },
  { label: 'Penalización (pesos base)', value: (a) => a.revision?.soft_penalty ?? 0, better: 'low' },
  { label: 'Franjas no preferidas (S1)', value: (a) => a.revision?.soft_breakdown?.S1_TEACHER_PREFERENCE ?? 0, better: 'low' },
  { label: 'Franjas extremas (S2)', value: (a) => a.revision?.soft_breakdown?.S2_EDGE_SLOT ?? 0, better: 'low' },
  { label: 'Puestos vacíos (S3)', value: (a) => a.revision?.soft_breakdown?.S3_ROOM_WASTE ?? 0, better: 'low' },
  { label: 'Sobrecarga diaria (S4)', value: (a) => a.revision?.soft_breakdown?.S4_COHORT_DAY_LOAD ?? 0, better: 'low' },
  { label: 'Sesiones movibles', value: (a) => a.metrics.slack.mobility.movable_share, better: 'high', format: pct },
  { label: 'Franjas alternativas por sesión', value: (a) => a.metrics.slack.mobility.avg_alternative_slots, better: 'high' },
  { label: 'Aulas libres por franja (mín.)', value: (a) => a.metrics.slack.free_rooms_per_slot_min, better: 'high' },
  { label: 'Franjas libres por docente (mín.)', value: (a) => a.metrics.slack.teacher_free_slots_min, better: 'high' },
  { label: 'Uso de aulas', value: (a) => a.metrics.room_utilization, better: 'high', format: pct },
];

export function bestOrdinals(items: ComparisonItem[], m: MetricDef): Set<number> {
  const values = items.map(m.value);
  const target = m.better === 'low' ? Math.min(...values) : Math.max(...values);
  return new Set(items.filter((a) => m.value(a) === target).map((a) => a.ordinal));
}

export function ComparePage() {
  const { id = '' } = useParams();
  const { api } = useSession();
  const [data, setData] = useState<Comparison | null>(null);
  const [slots, setSlots] = useState<SlotInfo[]>([]);
  const [cohort, setCohort] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getComparison(id).then(async (c) => {
      setData(c);
      if (c.alternatives[0]) {
        const detail = await api.getAlternative(c.alternatives[0].id);
        setSlots(detail.context.slots);
      }
      setCohort(c.alternatives[0]?.assignments[0]?.cohort ?? '');
    }).catch((e: Error) => setError(e.message));
  }, [api, id]);

  const cohorts = useMemo(
    () => [...new Set(data?.alternatives.flatMap((a) => a.assignments.map((x) => x.cohort)) ?? [])].sort(),
    [data],
  );

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Cargando…</p>;

  return (
    <>
      <section className="panel">
        <p><Link to={`/requests/${id}`}>← Solicitud</Link></p>
        <h2>Comparación de alternativas</h2>
        <table aria-label="Métricas comparadas">
          <thead>
            <tr><th>Métrica</th>{data.alternatives.map((a) => (
              <th key={a.id}><Link to={`/alternatives/${a.id}`}>Alternativa {a.ordinal}</Link><br /><span className="muted">{a.profile}</span></th>
            ))}</tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const best = bestOrdinals(data.alternatives, m);
              return (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  {data.alternatives.map((a) => (
                    <td key={a.id} data-best={best.has(a.ordinal) || undefined}>
                      {best.has(a.ordinal) ? <strong>{(m.format ?? String)(m.value(a))} ★</strong> : (m.format ?? String)(m.value(a))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Diferencia entre alternativas</h3>
        <p className="muted">Porcentaje de sesiones en franja distinta (umbral mínimo 30 %).</p>
        <table aria-label="Diversidad">
          <tbody>
            {data.pairwise_diversity.map((row, i) => (
              <tr key={i}><th>Alt. {i + 1}</th>{row.map((v, j) => <td key={j}>{i === j ? '—' : pct(v)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="row">
          <h2 style={{ flex: 1 }}>Horario por cohorte</h2>
          <label>Cohorte
            <select value={cohort} onChange={(e) => setCohort(e.target.value)}>{cohorts.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <div className="grid-compare">
          {data.alternatives.map((a) => (
            <div key={a.id}>
              <h3>Alternativa {a.ordinal}</h3>
              <Timetable assignments={a.assignments} slots={slots} filter={cohort ? { kind: 'cohort', value: cohort } : null} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
