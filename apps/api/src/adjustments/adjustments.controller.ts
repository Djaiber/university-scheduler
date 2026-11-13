import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, directorProgram } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { assertRequestVisible } from '../auth/scope';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';

type Priority = 'ALTA' | 'MEDIA' | 'BAJA';
interface CreateBody { schedule_request_id: string; group_code?: string; description: string; priority?: Priority }
interface ResolveBody { status: 'RESUELTA' | 'RECHAZADA'; resolution: string; revision_id?: string }

const createSchema = {
  type: 'object', additionalProperties: false, required: ['schedule_request_id', 'description'],
  properties: {
    schedule_request_id: { type: 'string', format: 'uuid' },
    group_code: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: 'string', minLength: 10, maxLength: 1000 },
    priority: { enum: ['ALTA', 'MEDIA', 'BAJA'], default: 'MEDIA' },
  },
};
const prioritySchema = {
  type: 'object', additionalProperties: false, required: ['priority'], properties: { priority: { enum: ['ALTA', 'MEDIA', 'BAJA'] } },
};
const resolveSchema = {
  type: 'object', additionalProperties: false, required: ['status', 'resolution'],
  properties: {
    status: { enum: ['RESUELTA', 'RECHAZADA'] },
    resolution: { type: 'string', minLength: 5, maxLength: 1000 },
    revision_id: { type: 'string', format: 'uuid' },
  },
};

const SELECT = `SELECT a.id, a.schedule_request_id, p.code AS program, a.group_code, a.description, a.priority, a.status,
                       a.created_by, a.created_at, a.prioritized_by, a.prioritized_at, a.resolved_by, a.resolved_at,
                       a.resolution, a.revision_id, v.revision_no
                  FROM adjustment_requests a JOIN programs p ON p.id = a.program_id
                  LEFT JOIN schedule_revisions v ON v.id = a.revision_id`;
const ORDER = `ORDER BY (a.status <> 'ABIERTA'), array_position(ARRAY['ALTA','MEDIA','BAJA']::adjustment_priority[], a.priority), a.created_at`;

/**
 * Solicitudes de ajuste priorizadas (SCRUM-45): el DIRECTOR las registra y prioriza para su programa;
 * el ADMINISTRADOR las atiende en el editor (drag-and-drop) y las cierra enlazando la revisión resultante.
 */
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR')
  async list(@Query('request') requestId: string | undefined, @CurrentUser() user: AuthUser) {
    if (requestId && !/^[0-9a-f-]{36}$/i.test(requestId)) throw new BadRequestException('request debe ser un UUID');
    return this.db.query(
      `${SELECT} WHERE ($1::uuid IS NULL OR a.schedule_request_id = $1) AND ($2::uuid IS NULL OR a.program_id = $2) ${ORDER} LIMIT 500`,
      [requestId ?? null, directorProgram(user)],
    );
  }

  @Post()
  @Roles('DIRECTOR')
  create(@Body(new SchemaValidationPipe<CreateBody>(createSchema)) b: CreateBody, @CurrentUser() user: AuthUser) {
    if (!user.programId) throw new ForbiddenException('El director no tiene un programa asignado en el directorio');
    return this.db.tx(async (tx) => {
      await assertRequestVisible(tx, { ...user, roles: ['DIRECTOR'] }, b.schedule_request_id);
      const { rows: [req] } = await tx.query<{ status: string }>('SELECT status FROM schedule_requests WHERE id = $1', [b.schedule_request_id]);
      if (!req) throw new NotFoundException('Solicitud no encontrada');
      if (['PUBLISHED', 'CANCELLED'].includes(req.status)) throw new ConflictException(`La solicitud está en ${req.status}; ya no admite ajustes`);
      if (b.group_code) await this.assertGroupInProgram(tx, b.schedule_request_id, b.group_code, user.programId!);
      const { rows: [row] } = await tx.query<{ id: string }>(
        `INSERT INTO adjustment_requests(schedule_request_id, program_id, group_code, description, priority, created_by, prioritized_by, prioritized_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, now()) RETURNING id`,
        [b.schedule_request_id, user.programId, b.group_code ?? null, b.description, b.priority ?? 'MEDIA', user.sub],
      );
      await audit(tx, { actor: user.sub, action: 'ADJUSTMENT_REQUESTED', entityType: 'adjustment_request', entityId: row.id,
        reason: b.description, after: { priority: b.priority ?? 'MEDIA', group: b.group_code ?? null } });
      return this.one(tx, row.id);
    });
  }

  @Patch(':id/priority')
  @Roles('DIRECTOR')
  prioritize(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaValidationPipe<{ priority: Priority }>(prioritySchema)) b: { priority: Priority },
    @CurrentUser() user: AuthUser,
  ) {
    return this.db.tx(async (tx) => {
      const before = await this.one(tx, id);
      const { rows: [own] } = await tx.query('SELECT 1 FROM adjustment_requests WHERE id = $1 AND program_id = $2', [id, user.programId ?? null]);
      if (!own) throw new ForbiddenException('La solicitud de ajuste pertenece a otro programa');
      // El trigger impide repriorizar una solicitud cerrada
      await tx.query('UPDATE adjustment_requests SET priority = $2, prioritized_by = $3, prioritized_at = now() WHERE id = $1', [id, b.priority, user.sub]);
      await audit(tx, { actor: user.sub, action: 'ADJUSTMENT_PRIORITIZED', entityType: 'adjustment_request', entityId: id,
        before: { priority: before.priority }, after: { priority: b.priority } });
      return this.one(tx, id);
    });
  }

  @Post(':id/resolve')
  @Roles('ADMINISTRADOR')
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaValidationPipe<ResolveBody>(resolveSchema)) b: ResolveBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.db.tx(async (tx) => {
      const adj = await this.one(tx, id);
      if (b.revision_id) {
        const { rows: [ok] } = await tx.query(
          `SELECT 1 FROM schedule_revisions v JOIN schedule_alternatives a ON a.id = v.alternative_id
             JOIN optimization_runs o ON o.id = a.run_id WHERE v.id = $1 AND o.request_id = $2`,
          [b.revision_id, adj.schedule_request_id],
        );
        if (!ok) throw new BadRequestException('La revisión no pertenece a la solicitud de horario del ajuste');
      }
      await tx.query(
        'UPDATE adjustment_requests SET status = $2, resolution = $3, revision_id = $4, resolved_by = $5, resolved_at = now() WHERE id = $1',
        [id, b.status, b.resolution, b.revision_id ?? null, user.sub],
      );
      await audit(tx, { actor: user.sub, action: `ADJUSTMENT_${b.status}`, entityType: 'adjustment_request', entityId: id,
        reason: b.resolution, after: { revision_id: b.revision_id ?? null } });
      return this.one(tx, id);
    });
  }

  private async one(q: Queryable, id: string) {
    const { rows: [row] } = await q.query(`${SELECT} WHERE a.id = $1`, [id]);
    if (!row) throw new NotFoundException('Solicitud de ajuste no encontrada');
    return row;
  }

  private async assertGroupInProgram(q: Queryable, requestId: string, groupCode: string, programId: string) {
    const { rows: [g] } = await q.query(
      `SELECT 1 FROM groups g JOIN courses c ON c.id = g.course_id JOIN schedule_requests r ON r.period_id = g.period_id
        WHERE r.id = $1 AND g.code = $2 AND c.program_id = $3`,
      [requestId, groupCode, programId],
    );
    if (!g) throw new BadRequestException(`El grupo ${groupCode} no pertenece al programa del director en ese período`);
  }
}
