import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Put, Query } from '@nestjs/common';
import { AuthUser, isStaff } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';

type Availability = 'AVAILABLE' | 'NOT_PREFERRED' | 'UNAVAILABLE';
interface AvailabilityBody { slots: { slot: string; availability: Availability }[] }

const availabilitySchema = {
  type: 'object', additionalProperties: false, required: ['slots'],
  properties: {
    slots: {
      type: 'array', maxItems: 200,
      items: {
        type: 'object', additionalProperties: false, required: ['slot', 'availability'],
        properties: { slot: { type: 'string', minLength: 1 }, availability: { enum: ['AVAILABLE', 'NOT_PREFERRED', 'UNAVAILABLE'] } },
      },
    },
  },
};

export interface SlotView { id: string; day: number; index: number; starts_at: string; ends_at: string; edge: boolean }
export interface PublishedSession {
  group: string; session: number; course: string; course_name: string; program: string; teacher: string; teacher_name: string;
  cohort: string; room: string; building: string; slot: string; day: number; starts_at: string; ends_at: string;
}

/**
 * Portal de DOCENTE y ESTUDIANTE (SCRUM-45): consulta del horario publicado y registro de disponibilidad.
 * Solo se expone lo publicado (aprobado por el comité y publicado por el administrador), nunca borradores.
 */
@Controller()
export class PortalController {
  constructor(private readonly db: DatabaseService) {}

  private async period(q: Queryable, code: string | undefined) {
    if (!code) throw new BadRequestException('El parámetro period es obligatorio');
    const { rows: [p] } = await q.query<{ id: string; code: string }>('SELECT id, code FROM academic_periods WHERE code = $1', [code]);
    if (!p) throw new NotFoundException(`El período ${code} no existe`);
    return p;
  }

  private async slots(q: Queryable, periodId: string): Promise<SlotView[]> {
    const { rows } = await q.query<Omit<SlotView, 'index'>>(
      `SELECT code AS id, day_of_week AS day, to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at,
              is_edge AS edge
         FROM time_slots WHERE period_id = $1 ORDER BY day_of_week, starts_at`,
      [periodId],
    );
    const seen = new Map<number, number>();
    return rows.map((s) => {
      const index = seen.get(s.day) ?? 0;
      seen.set(s.day, index + 1);
      return { ...s, index };
    });
  }

  /** Última publicación del período que cubre el programa (o institucional si no se indica programa). */
  private async latestPublication(q: Queryable, periodId: string, programCode?: string) {
    const { rows: [pub] } = await q.query<{ id: string; published_at: string; published_by: string; revision_id: string; revision_no: number; content_sha256: string; program: string | null }>(
      `SELECT p.id, p.published_at, p.published_by, ap.revision_id, v.revision_no, trim(v.content_sha256) AS content_sha256, pr.code AS program
         FROM publications p JOIN approvals ap ON ap.id = p.approval_id JOIN schedule_revisions v ON v.id = ap.revision_id
         JOIN schedule_alternatives a ON a.id = v.alternative_id JOIN optimization_runs o ON o.id = a.run_id
         JOIN schedule_requests r ON r.id = o.request_id LEFT JOIN programs pr ON pr.id = r.program_id
        WHERE r.period_id = $1 AND ($2::text IS NULL OR r.program_id IS NULL OR pr.code = $2)
        ORDER BY p.published_at DESC LIMIT 1`,
      [periodId, programCode ?? null],
    );
    return pub ?? null;
  }

  private async sessions(q: Queryable, revisionId: string, f: { program?: string; cohort?: string; teacher?: string }) {
    const { rows } = await q.query<Omit<PublishedSession, 'day' | 'starts_at' | 'ends_at'> & { day_of_week: number; starts_at: string; ends_at: string }>(
      `SELECT g.code AS "group", a.session_index AS session, co.code AS course, co.name AS course_name, pr.code AS program,
              t.external_code AS teacher, t.full_name AS teacher_name, g.cohort, c.code AS room, c.building,
              s.code AS slot, s.day_of_week, to_char(s.starts_at, 'HH24:MI') AS starts_at, to_char(s.ends_at, 'HH24:MI') AS ends_at
         FROM assignments a JOIN groups g ON g.id = a.group_id JOIN courses co ON co.id = g.course_id
         JOIN programs pr ON pr.id = co.program_id JOIN teachers t ON t.id = g.teacher_id
         JOIN time_slots s ON s.id = a.slot_id JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.revision_id = $1 AND ($2::text IS NULL OR pr.code = $2) AND ($3::text IS NULL OR g.cohort = $3)
          AND ($4::text IS NULL OR t.external_code = $4)
        ORDER BY s.day_of_week, s.starts_at, g.code`,
      [revisionId, f.program ?? null, f.cohort ?? null, f.teacher ?? null],
    );
    return rows.map(({ day_of_week, ...r }) => ({ ...r, day: day_of_week }));
  }

  /**
   * Horario publicado. Un ESTUDIANTE queda limitado a su programa (y por defecto a su cohorte);
   * el resto de actores puede filtrar por programa, cohorte o docente.
   */
  @Get('published-schedules')
  async published(
    @Query('period') periodCode: string | undefined,
    @Query('program') program: string | undefined,
    @Query('cohort') cohort: string | undefined,
    @Query('teacher') teacher: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const studentOnly = user.roles.includes('ESTUDIANTE') && !isStaff(user) && !user.roles.includes('DIRECTOR') && !user.roles.includes('DOCENTE');
    if (studentOnly) {
      if (!user.programCode) throw new ForbiddenException('El estudiante no tiene un programa asignado en el directorio');
      if (program && program !== user.programCode) throw new ForbiddenException('Solo puede consultar el horario de su programa');
      program = user.programCode;
      cohort = cohort ?? user.cohort;
    }
    const period = await this.period(this.db.pool, periodCode);
    const pub = await this.latestPublication(this.db.pool, period.id, program);
    if (!pub) return { period: period.code, publication: null, slots: [], sessions: [], cohorts: [] };
    const all = await this.sessions(this.db.pool, pub.revision_id, { program });
    const sessions = all.filter((s) => (!cohort || s.cohort === cohort) && (!teacher || s.teacher === teacher));
    return {
      period: period.code,
      publication: { id: pub.id, published_at: pub.published_at, published_by: pub.published_by, revision_no: pub.revision_no,
        content_sha256: pub.content_sha256, program: pub.program },
      slots: await this.slots(this.db.pool, period.id),
      sessions,
      cohorts: [...new Set(all.map((s) => s.cohort))].sort(),
    };
  }

  private ownTeacher(user: AuthUser): { id: string; code: string } {
    if (!user.teacherId || !user.teacherCode) throw new ForbiddenException('El docente no está vinculado a un registro de docentes en el directorio');
    return { id: user.teacherId, code: user.teacherCode };
  }

  /** Horario publicado del docente autenticado. */
  @Get('me/schedule')
  @Roles('DOCENTE')
  async mySchedule(@Query('period') periodCode: string | undefined, @CurrentUser() user: AuthUser) {
    const teacher = this.ownTeacher(user);
    const period = await this.period(this.db.pool, periodCode);
    const pub = await this.latestPublication(this.db.pool, period.id);
    return {
      period: period.code,
      teacher: teacher.code,
      publication: pub && { id: pub.id, published_at: pub.published_at, revision_no: pub.revision_no },
      slots: await this.slots(this.db.pool, period.id),
      sessions: pub ? await this.sessions(this.db.pool, pub.revision_id, { teacher: teacher.code }) : [],
    };
  }

  @Get('me/availability')
  @Roles('DOCENTE')
  async myAvailability(@Query('period') periodCode: string | undefined, @CurrentUser() user: AuthUser) {
    const teacher = this.ownTeacher(user);
    const period = await this.period(this.db.pool, periodCode);
    return this.availabilityView(this.db.pool, period, teacher);
  }

  /**
   * Reemplaza la disponibilidad del docente para el período (lo no enviado queda AVAILABLE).
   * Se cierra cuando el período ya tiene un horario publicado: desde ahí los cambios van por el director.
   */
  @Put('me/availability')
  @Roles('DOCENTE')
  saveAvailability(
    @Query('period') periodCode: string | undefined,
    @Body(new SchemaValidationPipe<AvailabilityBody>(availabilitySchema)) b: AvailabilityBody,
    @CurrentUser() user: AuthUser,
  ) {
    const teacher = this.ownTeacher(user);
    return this.db.tx(async (tx) => {
      const period = await this.period(tx, periodCode);
      if (await this.latestPublication(tx, period.id)) {
        throw new ConflictException('El horario del período ya fue publicado; solicite el cambio a la dirección de su programa');
      }
      const slots = await this.slots(tx, period.id);
      const known = new Set(slots.map((s) => s.id));
      const unknown = b.slots.filter((s) => !known.has(s.slot)).map((s) => s.slot);
      if (unknown.length) throw new BadRequestException(`Franjas inexistentes en ${period.code}: ${unknown.join(', ')}`);
      const before = await this.availabilityView(tx, period, teacher);
      await tx.query(
        'DELETE FROM teacher_availability a USING time_slots s WHERE a.slot_id = s.id AND s.period_id = $1 AND a.teacher_id = $2',
        [period.id, teacher.id],
      );
      for (const s of b.slots.filter((x) => x.availability !== 'AVAILABLE')) {
        await tx.query(
          `INSERT INTO teacher_availability(teacher_id, slot_id, availability, updated_by, updated_at)
           SELECT $1, id, $3, $4, now() FROM time_slots WHERE period_id = $2 AND code = $5`,
          [teacher.id, period.id, s.availability, user.sub, s.slot],
        );
      }
      const after = await this.availabilityView(tx, period, teacher);
      const summary = (v: typeof after) => Object.fromEntries(v.slots.filter((s) => s.availability !== 'AVAILABLE').map((s) => [s.id, s.availability]));
      await audit(tx, { actor: user.sub, action: 'AVAILABILITY_UPDATED', entityType: 'teacher', entityId: teacher.code,
        before: summary(before), after: summary(after) });
      return after;
    });
  }

  private async availabilityView(q: Queryable, period: { id: string; code: string }, teacher: { id: string; code: string }) {
    const slots = await this.slots(q, period.id);
    const { rows } = await q.query<{ slot: string; availability: Availability; updated_at: string }>(
      `SELECT s.code AS slot, a.availability, a.updated_at FROM teacher_availability a JOIN time_slots s ON s.id = a.slot_id
        WHERE s.period_id = $1 AND a.teacher_id = $2`,
      [period.id, teacher.id],
    );
    const by = new Map(rows.map((r) => [r.slot, r.availability]));
    const locked = Boolean(await this.latestPublication(q, period.id));
    return {
      period: period.code,
      teacher: teacher.code,
      locked,
      updated_at: rows.map((r) => r.updated_at).sort().at(-1) ?? null,
      slots: slots.map((s) => ({ ...s, availability: by.get(s.id) ?? 'AVAILABLE' })),
    };
  }
}
