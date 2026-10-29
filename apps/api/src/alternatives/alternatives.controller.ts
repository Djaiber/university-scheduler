import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Actor } from '../common/actor.decorator';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { AlternativesService } from './alternatives.service';
import { Change, NewRevision, RevisionsService } from './revisions.service';

const change = {
  type: 'object', additionalProperties: false, required: ['group', 'session', 'slot', 'room'],
  properties: { group: { type: 'string' }, session: { type: 'integer', minimum: 0 }, slot: { type: 'string' }, room: { type: 'string' } },
};
const revisionSchema = {
  type: 'object', additionalProperties: false, required: ['base_revision_id', 'changes', 'reason'],
  properties: {
    base_revision_id: { type: 'string', format: 'uuid' },
    changes: { type: 'array', minItems: 1, maxItems: 50, items: change },
    reason: { type: 'string', minLength: 5, maxLength: 500 },
  },
};
const previewSchema = { type: 'object', additionalProperties: false, required: ['changes'], properties: { changes: { type: 'array', items: change } } };

@Controller()
export class AlternativesController {
  constructor(private readonly alternatives: AlternativesService, private readonly revisionsSvc: RevisionsService) {}

  @Get('alternatives/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.get(id);
  }

  @Get('alternatives/:id/revisions')
  revisions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.revisions(id);
  }

  /** Guarda un ajuste manual como revisión nueva, revalidada (RF-10). */
  @Post('alternatives/:id/revisions')
  createRevision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaValidationPipe<NewRevision>(revisionSchema)) body: NewRevision,
    @Actor() actor: string,
  ) {
    return this.revisionsSvc.create(id, body, actor);
  }

  @Post('alternatives/:id/preview')
  @HttpCode(200)
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Body(new SchemaValidationPipe<{ changes: Change[] }>(previewSchema)) body: { changes: Change[] }) {
    return this.revisionsSvc.preview(id, body.changes);
  }

  @Get('schedule-requests/:id/comparison')
  comparison(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.comparison(id);
  }
}
