import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Post, Query } from '@nestjs/common';
import { AuthUser, directorProgram } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';
import { offerFingerprint, offerGroups, offerStatuses } from './offer';

interface ConsolidateBody { period: string; notes?: string }
interface ReopenBody { period: string; reason: string }

const consolidateSchema = {
  type: 'object', additionalProperties: false, required: ['period'],
  properties: { period: { type: 'string', pattern: '^[0-9]{4}-[12]$' }, notes: { type: 'string', maxLength: 1000 } },
};
const reopenSchema = {
  type: 'object', additionalProperties: false, required: ['period', 'reason'],
  properties: { period: { type: 'string', pattern: '^[0-9]{4}-[12]$' }, reason: { type: 'string', minLength: 5, maxLength: 1000 } },
};

/**
 * Oferta académica por programa (SCRUM-45). El DIRECTOR revisa los grupos de su programa y la consolida;
 * sin oferta consolidada (y vigente) el ADMINISTRADOR no puede lanzar la generación.
 */
@Controller('offers')
export class OffersController {
  constructor(private readonly db: DatabaseService) {}

  private async periodId(q: Queryable, code: string): Promise<string> {
    const { rows: [p] } = await q.query<{ id: string }>('SELECT id FROM academic_periods WHERE code = $1', [code]);
    if (!p) throw new NotFoundException(`El período ${code} no existe`);
    return p.id;
  }

  private ownProgram(user: AuthUser): string {
    if (!user.programId) throw new ForbiddenException('El director no tiene un programa asignado en el directorio');
    return user.programId;
  }

  /** Estado de la oferta de cada programa; el DIRECTOR solo ve el suyo (con el detalle de grupos). */
  @Get()
  @Roles('ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR')
  async list(@Query('period') period: string, @CurrentUser() user: AuthUser) {
    if (!period) throw new BadRequestException('El parámetro period es obligatorio');
    const periodId = await this.periodId(this.db.pool, period);
    const scope = directorProgram(user);
    const statuses = await offerStatuses(this.db.pool, periodId, scope);
    if (!scope) return { period, programs: statuses };
    return { period, programs: statuses, groups: await offerGroups(this.db.pool, periodId, scope) };
  }

  @Post('consolidate')
  @Roles('DIRECTOR')
  consolidate(@Body(new SchemaValidationPipe<ConsolidateBody>(consolidateSchema)) b: ConsolidateBody, @CurrentUser() user: AuthUser) {
    const programId = this.ownProgram(user);
    return this.db.tx(async (tx) => {
      const periodId = await this.periodId(tx, b.period);
      const groups = await offerGroups(tx, periodId, programId);
      if (groups.length === 0) throw new ConflictException('El programa no tiene grupos cargados para el período');
      // Si había una consolidación desactualizada (la oferta cambió), se cierra y se registra la nueva
      await tx.query(
        `UPDATE offer_consolidations SET reopened_by = $3, reopened_at = now(), reopen_reason = 'Reconsolidada'
          WHERE period_id = $1 AND program_id = $2 AND reopened_at IS NULL`,
        [periodId, programId, user.sub],
      );
      const { rows: [row] } = await tx.query(
        `INSERT INTO offer_consolidations(period_id, program_id, groups_count, groups_sha256, notes, consolidated_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, groups_count, trim(groups_sha256) AS groups_sha256, consolidated_by, consolidated_at`,
        [periodId, programId, groups.length, offerFingerprint(groups), b.notes ?? null, user.sub],
      );
      await audit(tx, { actor: user.sub, action: 'OFFER_CONSOLIDATED', entityType: 'offer_consolidation', entityId: row.id,
        reason: b.notes, after: { period: b.period, program: user.programCode, groups: groups.length } });
      return row;
    });
  }

  @Post('reopen')
  @Roles('DIRECTOR')
  reopen(@Body(new SchemaValidationPipe<ReopenBody>(reopenSchema)) b: ReopenBody, @CurrentUser() user: AuthUser) {
    const programId = this.ownProgram(user);
    return this.db.tx(async (tx) => {
      const periodId = await this.periodId(tx, b.period);
      const { rows: [row] } = await tx.query<{ id: string }>(
        `UPDATE offer_consolidations SET reopened_by = $3, reopened_at = now(), reopen_reason = $4
          WHERE period_id = $1 AND program_id = $2 AND reopened_at IS NULL RETURNING id`,
        [periodId, programId, user.sub, b.reason],
      );
      if (!row) throw new ConflictException('La oferta no está consolidada');
      await audit(tx, { actor: user.sub, action: 'OFFER_REOPENED', entityType: 'offer_consolidation', entityId: row.id, reason: b.reason });
      return { id: row.id, reopened: true };
    });
  }
}
