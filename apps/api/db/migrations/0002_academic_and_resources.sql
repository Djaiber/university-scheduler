-- SCRUM-10 · Dominio académico y recursos (modelo canónico)
CREATE TABLE academic_periods (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                 -- p. ej. 2027-1
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  CHECK (ends_on > starts_on)
);

CREATE TABLE programs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  faculty     text NOT NULL
);

CREATE TABLE time_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES academic_periods(id),
  code        text NOT NULL,                        -- p. ej. MON-07
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  is_edge     boolean NOT NULL DEFAULT false,       -- primera/última franja (regla S2)
  CHECK (ends_at > starts_at),
  UNIQUE (period_id, code),
  UNIQUE (period_id, day_of_week, starts_at)
);

CREATE TABLE teachers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_code text NOT NULL UNIQUE,               -- identificador estable institucional
  full_name     text NOT NULL,
  email         text,                               -- único dato de contacto necesario (RNF-04)
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE classrooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  building      text NOT NULL,
  capacity      integer NOT NULL CHECK (capacity > 0),
  features      text[] NOT NULL DEFAULT '{}',       -- p. ej. {lab, projector}
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    uuid NOT NULL REFERENCES programs(id),
  code          text NOT NULL,
  name          text NOT NULL,
  semester      smallint NOT NULL CHECK (semester BETWEEN 1 AND 12),
  UNIQUE (program_id, code)
);

CREATE TABLE groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id          uuid NOT NULL REFERENCES academic_periods(id),
  course_id          uuid NOT NULL REFERENCES courses(id),
  code               text NOT NULL,                 -- p. ej. CAL1-A
  teacher_id         uuid NOT NULL REFERENCES teachers(id),
  cohort             text NOT NULL,                 -- estudiantes que no pueden solaparse (H4)
  size               integer NOT NULL CHECK (size > 0),
  sessions_per_week  smallint NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 6),
  required_features  text[] NOT NULL DEFAULT '{}',
  UNIQUE (period_id, code)
);
CREATE INDEX groups_teacher_idx ON groups (period_id, teacher_id);
CREATE INDEX groups_cohort_idx  ON groups (period_id, cohort);
