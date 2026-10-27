import type { Assignment, SlotInfo } from '@us/api-client';

const DAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface TimetableProps {
  assignments: Assignment[];
  slots: SlotInfo[];
  /** Filtra por cohorte, docente o aula; vacío = todas */
  filter?: { kind: 'cohort' | 'teacher' | 'room'; value: string } | null;
  selected?: string | null; // "grupo#sesión"
  violating?: Set<string>; // claves "grupo#sesión" con violaciones
  onSelect?: (key: string, a: Assignment) => void;
  onSlotClick?: (slotId: string) => void;
}

/** Grilla semanal: filas = franjas del día, columnas = días. */
export function Timetable({ assignments, slots, filter, selected, violating, onSelect, onSlotClick }: TimetableProps) {
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const maxIndex = Math.max(...slots.map((s) => s.index));
  const slotAt = (day: number, index: number) => slots.find((s) => s.day === day && s.index === index);
  const visible = filter
    ? assignments.filter((a) => (filter.kind === 'cohort' ? a.cohort : filter.kind === 'teacher' ? a.teacher : a.room) === filter.value)
    : assignments;

  return (
    <table className="timetable" aria-label="Horario semanal">
      <thead>
        <tr><th style={{ width: 40 }}>#</th>{days.map((d) => <th key={d}>{DAYS[d]}</th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: maxIndex + 1 }, (_, i) => (
          <tr key={i}>
            <th>{i + 1}</th>
            {days.map((d) => {
              const slot = slotAt(d, i);
              if (!slot) return <td key={d} />;
              const items = visible.filter((a) => a.slot === slot.id);
              return (
                <td key={d} data-slot={slot.id} onClick={() => onSlotClick?.(slot.id)}
                  style={{ cursor: onSlotClick ? 'copy' : 'default', background: slot.edge ? '#fafafa' : undefined }}>
                  {items.map((a) => {
                    const key = `${a.group}#${a.session}`;
                    return (
                      <span key={key} role="button" tabIndex={0}
                        className={`cell-item${selected === key ? ' selected' : ''}${violating?.has(key) ? ' violation' : ''}`}
                        title={`${a.group} · ${a.teacher} · ${a.room}`}
                        onClick={(e) => { e.stopPropagation(); onSelect?.(key, a); }}>
                        {a.course} · {a.room}
                      </span>
                    );
                  })}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
