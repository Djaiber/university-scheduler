import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';

interface ScopeBody { enabled?: boolean; weight?: number; params?: { max_daily_sessions_per_cohort?: number } }

const draftSchema = { type: 'object', additionalProperties: false, properties: { notes: { type: 'string', maxLength: 1000 } } };
const scopeSchema = {
  type: 'object', additionalProperties: false, minProperties: 1,
  properties: {
    enabled: { type: 'boolean' },
    weight: { type: 'integer', minimum: 0, maximum: 100 },
    params: { type: 'object', additionalProperties: false, properties: { max_daily_sessions_per_cohort: { type: 'integer', minimum: 1, maximum: 8 } } },
  },
};

/** Reglas duras que el modelo exige siempre: no se pueden desactivar (solo H9 es configurable). */
const LOCKED_HARD = ['H1_ALL_ASSIGNED', 'H2_TEACHER_CLASH', 'H3_ROOM_CLASH', 'H4_COHORT_CLASH', 'H5_ROOM_CAPACITY',
  'H6_ROOM_FEATURES', 'H7_TEACHER_AVAILABILITY', 'H8_ROOM_AVAILABILITY'];

/**
 * Configuración de reglas por el COMITÉ TÁCTICO (SCRUM-45). Una versión publicada es inmutable (trigger
 * rule_scopes_frozen); para cambiar se crea un borrador a partir de la última publicada, se ajusta y se publica.
 * Las solicitudes nuevas usan la última versión publicada; las existentes conservan la de su snapshot.
 */
@Controller('rule-versions')
export class RulesController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @Roles('COMITE_TACTICO', 'ADMINISTRADOR')
  list() {
    return this.db.query(
      `SELECT id, version, notes, published_at, published_by, (published_at IS NULL) AS draft FROM rule_versions ORDER BY version DESC`,
    );
  }

  @Get(':id')
  @Roles('COMITE_TACTICO', 'ADMINISTRADOR')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.detail(this.db.pool, id);
  }

  @Post()
  @Roles('COMITE_TACTICO')
  createDraft(@Body(new SchemaValidationPipe<{ notes?: string }>(draftSchema)) b: { notes?: string }, @CurrentUser() user: AuthUser) {
    return this.db.tx(async (tx) => {
      await tx.query('LOCK TABLE rule_versions IN SHARE ROW EXCLUSIVE MODE');
      const { rows: [draft] } = await tx.query('SELECT version FROM rule_versions WHERE published_at IS NULL');
      if (draft) throw new ConflictException(`Ya existe el borrador v${draft.version}; publíquelo o edítelo`);
      const { rows: [base] } = await tx.query<{ id: string; version: number }>(
        'SELECT id, version FROM rule_versions WHERE published_at IS NOT NULL ORDER BY version DESC LIMIT 1',
      );
      if (!base) throw new ConflictException('No hay una versión publicada de base');
      const { rows: [v] } = await tx.query<{ id: string; version: number }>(
        'INSERT INTO rule_versions(version, notes) VALUES ($1, $2) RETURNING id, version',
        [base.version + 1, b.notes ?? `Borrador basado en v${base.version}`],
      );
      await tx.query(
        `INSERT INTO rule_scopes(rule_version_id, rule_id, program_id, enabled, weight, params)
         SELECT $1, rule_id, program_id, enabled, weight, params FROM rule_scopes WHERE rule_version_id = $2`,
        [v.id, base.id],
      );
      await audit(tx, { actor: user.sub, action: 'RULE_VERSION_DRAFTED', entityType: 'rule_version', entityId: v.id,
        reason: b.notes, after: { version: v.version, base: base.version } });
      return this.detail(tx, v.id);
    });
  }

  @Put(':id/rules/:code')
  @Roles('COMITE_TACTICO')
  updateScope(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('code') code: string,
    @Body(new SchemaValidationPipe<ScopeBody>(scopeSchema)) b: ScopeBody,
    @CurrentUser() user: AuthUser,
  ) {
    return this.db.tx(async (tx) => {
      const { rows: [cur] } = await tx.query<{ rule_id: string; kind: string; enabled: boolean; weight: number | null; params: Record<string, unknown> }>(
        `SELECT s.rule_id, r.kind, s.enabled, s.weight, s.params FROM rule_scopes s JOIN academic_rules r ON r.id = s.rule_id
          WHERE s.rule_version_id = $1 AND r.code = $2 AND s.program_id IS NULL`,
        [id, code],
      );
      if (!cur) throw new NotFoundException(`La regla ${code} no está en la versión`);
      if (b.enabled === false && LOCKED_HARD.includes(code)) throw new BadRequestException(`La regla dura ${code} no se puede desactivar`);
      if (b.weight !== undefined && cur.kind !== 'SOFT') throw new BadRequestException('Solo las reglas blandas tienen peso');
      if (b.params !== undefined && code !== 'S4_COHORT_DAY_LOAD') throw new BadRequestException(`La regla ${code} no tiene parámetros configurables`);
      const next = { enabled: b.enabled ?? cur.enabled, weight: b.weight ?? cur.weight, params: { ...cur.params, ...(b.params ?? {}) } };
      // El trigger rule_scopes_frozen rechaza el cambio si la versión ya fue publicada
      await tx.query(
        'UPDATE rule_scopes SET enabled = $3, weight = $4, params = $5 WHERE rule_version_id = $1 AND rule_id = $2 AND program_id IS NULL',
        [id, cur.rule_id, next.enabled, next.weight, JSON.stringify(next.params)],
      );
      await audit(tx, { actor: user.sub, action: 'RULE_SCOPE_CHANGED', entityType: 'rule_version', entityId: id,
        before: { rule: code, enabled: cur.enabled, weight: cur.weight, params: cur.params }, after: { rule: code, ...next } });
      return this.detail(tx, id);
    });
  }

  @Post(':id/publish')
  @Roles('COMITE_TACTICO')
  publish(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.db.tx(async (tx) => {
      const { rows: [v] } = await tx.query<{ version: number }>(
        'UPDATE rule_versions SET published_at = now(), published_by = $2 WHERE id = $1 AND published_at IS NULL RETURNING version',
        [id, user.sub],
      );
      if (!v) throw new ConflictException('La versión no existe o ya fue publicada');
      await audit(tx, { actor: user.sub, action: 'RULE_VERSION_PUBLISHED', entityType: 'rule_version', entityId: id, after: { version: v.version } });
      return this.detail(tx, id);
    });
  }

  private async detail(q: Queryable, id: string) {
    const { rows: [v] } = await q.query(
      'SELECT id, version, notes, published_at, published_by, (published_at IS NULL) AS draft FROM rule_versions WHERE id = $1', [id],
    );
    if (!v) throw new NotFoundException('Versión de reglas no encontrada');
    const { rows: rules } = await q.query(
      `SELECT r.code, r.kind, r.description, s.enabled, s.weight, s.params,
              (r.code = ANY($2::text[])) AS locked
         FROM rule_scopes s JOIN academic_rules r ON r.id = s.rule_id
        WHERE s.rule_version_id = $1 AND s.program_id IS NULL ORDER BY r.kind, r.code`,
      [id, LOCKED_HARD],
    );
    return { ...v, rules };
  }
}
