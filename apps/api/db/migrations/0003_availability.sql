-- SCRUM-10 · Disponibilidades (ausencia de fila = AVAILABLE)
CREATE TABLE teacher_availability (
  teacher_id   uuid NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  slot_id      uuid NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  availability availability_kind NOT NULL,
  PRIMARY KEY (teacher_id, slot_id)
);

CREATE TABLE classroom_availability (
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  slot_id      uuid NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  available    boolean NOT NULL,
  reason       text,
  PRIMARY KEY (classroom_id, slot_id)
);
