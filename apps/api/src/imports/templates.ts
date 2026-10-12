/** Plantillas de importación v1 (data/templates/DICCIONARIO.md). Una sola fuente para validar y aplicar. */
export type ColumnType = 'string' | 'int' | 'bool' | 'time' | 'list' | 'enum';

export interface Column {
  name: string;
  type: ColumnType;
  required: boolean;
  pattern?: RegExp;
  min?: number;
  max?: number;
  catalog?: readonly string[];
}

export interface Reference {
  column: string;
  entity: 'teachers' | 'classrooms' | 'courses' | 'time_slots' | 'programs';
}

export interface Template {
  entity: EntityName;
  version: string;
  columns: Column[];
  key: string[]; // unicidad dentro del archivo
  references: Reference[];
}

export const FEATURES = ['projector', 'lab', 'computers', 'accessible', 'audio'] as const;
export const ENTITIES = [
  'time_slots', 'teachers', 'classrooms', 'courses', 'groups', 'teacher_availability', 'classroom_availability',
] as const;
export type EntityName = (typeof ENTITIES)[number];

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

export const TEMPLATES: Record<EntityName, Template> = {
  time_slots: {
    entity: 'time_slots', version: 'v1', key: ['code'], references: [],
    columns: [
      { name: 'code', type: 'string', required: true, pattern: CODE },
      { name: 'day_of_week', type: 'int', required: true, min: 1, max: 7 },
      { name: 'starts_at', type: 'time', required: true },
      { name: 'ends_at', type: 'time', required: true },
      { name: 'is_edge', type: 'bool', required: false },
    ],
  },
  teachers: {
    entity: 'teachers', version: 'v1', key: ['external_code'], references: [],
    columns: [
      { name: 'external_code', type: 'string', required: true, pattern: /^[A-Z0-9-]{2,20}$/ },
      { name: 'full_name', type: 'string', required: true, pattern: /^.{3,120}$/ },
      { name: 'email', type: 'string', required: false, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/ },
    ],
  },
  classrooms: {
    entity: 'classrooms', version: 'v1', key: ['code'], references: [],
    columns: [
      { name: 'code', type: 'string', required: true, pattern: CODE },
      { name: 'building', type: 'string', required: true },
      { name: 'capacity', type: 'int', required: true, min: 1, max: 500 },
      { name: 'features', type: 'list', required: false, catalog: FEATURES },
    ],
  },
  courses: {
    entity: 'courses', version: 'v1', key: ['program_code', 'code'],
    references: [{ column: 'program_code', entity: 'programs' }],
    columns: [
      { name: 'program_code', type: 'string', required: true },
      { name: 'code', type: 'string', required: true, pattern: CODE },
      { name: 'name', type: 'string', required: true },
      { name: 'semester', type: 'int', required: true, min: 1, max: 12 },
    ],
  },
  groups: {
    entity: 'groups', version: 'v1', key: ['code'],
    references: [{ column: 'course_code', entity: 'courses' }, { column: 'teacher_code', entity: 'teachers' }],
    columns: [
      { name: 'code', type: 'string', required: true, pattern: CODE },
      { name: 'course_code', type: 'string', required: true },
      { name: 'teacher_code', type: 'string', required: true },
      { name: 'cohort', type: 'string', required: true },
      { name: 'size', type: 'int', required: true, min: 1, max: 500 },
      { name: 'sessions_per_week', type: 'int', required: true, min: 1, max: 6 },
      { name: 'required_features', type: 'list', required: false, catalog: FEATURES },
    ],
  },
  teacher_availability: {
    entity: 'teacher_availability', version: 'v1', key: ['teacher_code', 'slot_code'],
    references: [{ column: 'teacher_code', entity: 'teachers' }, { column: 'slot_code', entity: 'time_slots' }],
    columns: [
      { name: 'teacher_code', type: 'string', required: true },
      { name: 'slot_code', type: 'string', required: true },
      { name: 'availability', type: 'enum', required: true, catalog: ['AVAILABLE', 'NOT_PREFERRED', 'UNAVAILABLE'] },
    ],
  },
  classroom_availability: {
    entity: 'classroom_availability', version: 'v1', key: ['classroom_code', 'slot_code'],
    references: [{ column: 'classroom_code', entity: 'classrooms' }, { column: 'slot_code', entity: 'time_slots' }],
    columns: [
      { name: 'classroom_code', type: 'string', required: true },
      { name: 'slot_code', type: 'string', required: true },
      { name: 'available', type: 'bool', required: true },
      { name: 'reason', type: 'string', required: false },
    ],
  },
};
