import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Actor } from '../common/actor.decorator';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
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
  constructor(private readonly requests: RequestsService) {}

  /** 202: la generación es asíncrona; el cliente consulta GET /schedule-requests/:id (RF-15). */
  @Post()
  @HttpCode(202)
  create(@Body(new SchemaValidationPipe<CreateRequest>(createSchema)) body: CreateRequest, @Actor() actor: string) {
    return this.requests.create(body, actor);
  }

  @Get()
  list(@Query('period') period?: string) {
    return this.requests.list(period);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.requests.get(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Actor() actor: string, @Body() body: { reason?: string }) {
    return this.requests.cancel(id, actor, body?.reason);
  }
}
