import type { PeriodSlot, PublishedSession } from '@us/api-client';

export const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** Horario semanal legible (filas = bloques horarios, columnas = días) para docentes y estudiantes. */
export function WeekSchedule({ slots, sessions, show = 'cohort' }: {
  slots: PeriodSlot[];
  sessions: PublishedSession[];
  show?: 'cohort' | 'teacher';
}) {
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const times = [...new Map(slots.map((s) => [`${s.starts_at}-${s.ends_at}`, s])).values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <table className="week" aria-label="Horario publicado">
      <thead><tr><th style={{ width: 82 }}>Hora</th>{days.map((d) => <th key={d}>{DAY_NAMES[d]}</th>)}</tr></thead>
      <tbody>
        {times.map((t) => (
          <tr key={t.starts_at}>
            <td className="time">{t.starts_at}<br />{t.ends_at}</td>
            {days.map((d) => (
              <td key={d}>
                {sessions.filter((s) => s.day === d && s.starts_at === t.starts_at).map((s) => (
                  <div key={`${s.group}#${s.session}`} className="session">
                    <strong>{s.course_name}</strong>
                    {s.group} · {s.room} ({s.building})<br />
                    <span className="muted">{show === 'cohort' ? s.teacher_name : `Cohorte ${s.cohort}`}</span>
                  </div>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
