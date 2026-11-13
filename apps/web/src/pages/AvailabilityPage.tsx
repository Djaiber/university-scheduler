import { useCallback, useEffect, useState } from 'react';
import type { AvailabilityKind, TeacherAvailability } from '@us/api-client';
import { PeriodSelect } from '../components/PeriodSelect';
import { DAY_NAMES } from '../components/WeekSchedule';
import { usePeriods } from '../hooks/usePeriods';
import { useSession } from '../session';

const NEXT: Record<AvailabilityKind, AvailabilityKind> = { AVAILABLE: 'NOT_PREFERRED', NOT_PREFERRED: 'UNAVAILABLE', UNAVAILABLE: 'AVAILABLE' };
const TEXT: Record<AvailabilityKind, string> = { AVAILABLE: 'Disponible', NOT_PREFERRED: 'Prefiero no', UNAVAILABLE: 'No disponible' };

/**
 * Disponibilidad del DOCENTE (SCRUM-45). Cada clic en una franja rota entre disponible → prefiero no →
 * no disponible. «No disponible» es una restricción dura para el motor; «prefiero no» es una preferencia.
 */
export function AvailabilityPage() {
  const { api, me } = useSession();
  const { periods, period, setPeriod } = usePeriods();
  const [data, setData] = useState<TeacherAvailability | null>(null);
  const [draft, setDraft] = useState<Record<string, AvailabilityKind>>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!period) return;
    const d = await api.myAvailability(period);
    setData(d);
    setDraft(Object.fromEntries(d.slots.map((s) => [s.id, s.availability])));
  }, [api, period]);
  useEffect(() => { setMsg(null); load().catch((e: Error) => setMsg({ kind: 'error', text: e.message })); }, [load]);

  const changed = data ? data.slots.filter((s) => draft[s.id] !== s.availability).length : 0;

  async function save() {
    try {
      const d = await api.saveMyAvailability(period, Object.entries(draft).map(([slot, availability]) => ({ slot, availability })));
      setData(d);
      setMsg({ kind: 'ok', text: 'Disponibilidad guardada. Se usará en la próxima generación del período.' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  const days = data ? [...new Set(data.slots.map((s) => s.day))].sort() : [];
  const rows = data ? Math.max(...data.slots.map((s) => s.index)) + 1 : 0;
  const count = (k: AvailabilityKind) => Object.values(draft).filter((v) => v === k).length;

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Docente{me?.display_name ? ` · ${me.display_name}` : ''}</p>
        <h2>Mi disponibilidad</h2>
        <div className="row">
          <PeriodSelect periods={periods} value={period} onChange={setPeriod} />
          {data && !data.locked && <button onClick={() => void save()} disabled={changed === 0}>Guardar ({changed} cambios)</button>}
          {data && !data.locked && changed > 0 && <button className="secondary" onClick={() => void load()}>Descartar</button>}
        </div>
        {data?.locked && <p className="notice">El horario de {data.period} ya fue publicado: la disponibilidad está cerrada. Si necesita un cambio, solicítelo a la dirección de su programa.</p>}
        {data && <p className="muted">{count('UNAVAILABLE')} franjas no disponibles · {count('NOT_PREFERRED')} no preferidas{data.updated_at ? ` · última actualización ${new Date(data.updated_at).toLocaleString('es-CO')}` : ''}</p>}
        {msg && <p className={msg.kind === 'error' ? 'error' : 'success'} role="alert">{msg.text}</p>}
      </section>

      {data && (
        <section className="panel">
          <table className="week" aria-label="Disponibilidad semanal">
            <thead><tr><th style={{ width: 82 }}>Hora</th>{days.map((d) => <th key={d}>{DAY_NAMES[d]}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => {
                const any = data.slots.find((s) => s.index === i);
                return (
                  <tr key={i}>
                    <td className="time">{any?.starts_at}<br />{any?.ends_at}</td>
                    {days.map((d) => {
                      const slot = data.slots.find((s) => s.day === d && s.index === i);
                      if (!slot) return <td key={d} />;
                      const v = draft[slot.id];
                      return (
                        <td key={d}>
                          <button className={`avail ${v}`} disabled={data.locked} aria-label={`${DAY_NAMES[d]} ${slot.starts_at}: ${TEXT[v]}`}
                            onClick={() => setDraft({ ...draft, [slot.id]: NEXT[v] })}>{TEXT[v]}</button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="legend">
            <span><i style={{ background: 'var(--green-soft)', border: '1px solid var(--mint)' }} />Disponible</span>
            <span><i style={{ background: 'var(--peach)' }} />Prefiero no (preferencia)</span>
            <span><i style={{ background: 'var(--orange)' }} />No disponible (restricción)</span>
          </div>
        </section>
      )}
    </>
  );
}
