import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, directorProgram } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { assertRequestVisible } from '../auth/scope';
import { DatabaseService } from '../database/database.service';
import { Actor } from '../common/actor.decorator';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { JobPublisher } from '../queue/job-publisher.service';
import { CreateRequest, RequestsService } from './requests.service';

const createSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['period'],
  properties: {
    period: { type: 'string', pattern: '^[0-9]{4}-[12]$' },
    program: { type: 'string' },
    alternatives_requested: { type: 'integer', minimum: 1, maximum: 4, default: 4 },
    optimization_profile: { enum: ['balanced', 'teacher_friendly', 'compact', 'room_efficient'], default: 'balanced' },
    time_limit_seconds: { type: 'integer', minimum: 5, maximum: 3600, default: 120 },
    min_diversity: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
    seed: { type: 'integer', minimum: 0, default: 0 },
  },
};

@Controller('schedule-requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService, private readonly publisher: JobPublisher, private readonly db: DatabaseService) {}

  /** 202: la generación es asíncrona; el cliente consulta GET /schedule-requests/:id (RF-15). Solo el ADMINISTRADOR lanza. */
  @Post()
  @HttpCode(202)
  @Roles('ADMINISTRADOR')
  async create(@Body(new SchemaValidationPipe<CreateRequest>(createSchema)) body: CreateRequest, @Actor() actor: string) {
    const created = await this.requests.create(body, actor);
    // Tras el COMMIT; si falla, el barrido del outbox lo reintenta y la solicitud no se pierde
    const published = await this.publisher.publish(created.run_id).catch(() => false);
    return { ...created, published };
  }

  @Get()
  @Roles('ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR')
  list(@Query('period') period: string | undefined, @CurrentUser() user: AuthUser) {
    return this.requests.list(period, directorProgram(user));
  }

  @Get(':id')
  @Roles('ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR')
  async get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    await assertRequestVisible(this.db.pool, user, id);
    return this.requests.get(id);
  }

  @Post(':id/cancel')
  @Roles('ADMINISTRADOR')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Actor() actor: string, @Body() body: { reason?: string }) {
    return this.requests.cancel(id, actor, body?.reason);
  }
}
