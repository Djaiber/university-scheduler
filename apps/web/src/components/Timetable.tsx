import { DragEvent, useState } from 'react';
import type { Assignment, SlotInfo } from '@us/api-client';

const DAYS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface TimetableProps {
  assignments: Assignment[];
  slots: SlotInfo[];
  /** Filtra por cohorte, docente o aula; vacío = todas */
  filter?: { kind: 'cohort' | 'teacher' | 'room'; value: string } | null;
  selected?: string | null; // "grupo#sesión"
  violating?: Set<string>; // claves "grupo#sesión" con violaciones
  pending?: Set<string>; // claves "grupo#sesión" movidas y aún sin guardar
  onSelect?: (key: string, a: Assignment) => void;
  onSlotClick?: (slotId: string) => void;
  /** Activa el arrastre (solo ADMINISTRADOR): soltar una sesión en otra franja la mueve. */
  onDropSession?: (a: Assignment, slotId: string) => void;
}

const keyOf = (a: Assignment) => `${a.group}#${a.session}`;

/**
 * Grilla semanal: filas = franjas del día, columnas = días.
 * Con `onDropSession` las sesiones se arrastran a otra franja (drag-and-drop). Alternativa accesible:
 * seleccionar la sesión (clic o Enter) y luego la franja destino (clic o Enter sobre la celda).
 */
export function Timetable({ assignments, slots, filter, selected, violating, pending, onSelect, onSlotClick, onDropSession }: TimetableProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const maxIndex = Math.max(...slots.map((s) => s.index));
  const slotAt = (day: number, index: number) => slots.find((s) => s.day === day && s.index === index);
  const visible = filter
    ? assignments.filter((a) => (filter.kind === 'cohort' ? a.cohort : filter.kind === 'teacher' ? a.teacher : a.room) === filter.value)
    : assignments;
  const draggable = Boolean(onDropSession);

  const drop = (e: DragEvent, slotId: string) => {
    e.preventDefault();
    const key = dragKey ?? e.dataTransfer?.getData('text/plain');
    const a = assignments.find((x) => keyOf(x) === key);
    setDragKey(null);
    setOver(null);
    if (a && a.slot !== slotId) onDropSession?.(a, slotId);
  };

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
              const target = Boolean(onSlotClick && selected);
              return (
                <td key={d} data-slot={slot.id}
                  className={`${slot.edge ? 'edge' : ''}${over === slot.id ? ' drop-target' : ''}`}
                  tabIndex={target ? 0 : undefined}
                  aria-label={target ? `Mover a ${DAYS[d]} franja ${i + 1}` : undefined}
                  onClick={() => onSlotClick?.(slot.id)}
                  onKeyDown={(e) => { if (target && e.key === 'Enter') onSlotClick?.(slot.id); }}
                  onDragOver={draggable ? (e) => { e.preventDefault(); if (over !== slot.id) setOver(slot.id); } : undefined}
                  onDragLeave={draggable ? () => setOver((o) => (o === slot.id ? null : o)) : undefined}
                  onDrop={draggable ? (e) => drop(e, slot.id) : undefined}
                  style={{ cursor: target ? 'copy' : 'default' }}>
                  {items.map((a) => {
                    const key = keyOf(a);
                    const cls = ['cell-item', selected === key && 'selected', pending?.has(key) && 'pending',
                      violating?.has(key) && 'violation', dragKey === key && 'dragging'].filter(Boolean).join(' ');
                    return (
                      <span key={key} role="button" tabIndex={0} className={cls} draggable={draggable || undefined}
                        title={`${a.group} · ${a.teacher} · ${a.room}${draggable ? ' — arrastre para mover' : ''}`}
                        onDragStart={(e) => { setDragKey(key); e.dataTransfer?.setData('text/plain', key); onSelect?.(key, a); }}
                        onDragEnd={() => { setDragKey(null); setOver(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onSelect?.(key, a); } }}
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
