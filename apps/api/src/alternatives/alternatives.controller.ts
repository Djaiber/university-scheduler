import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AlternativesService } from './alternatives.service';

@Controller()
export class AlternativesController {
  constructor(private readonly alternatives: AlternativesService) {}

  @Get('alternatives/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.get(id);
  }

  @Get('alternatives/:id/revisions')
  revisions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.revisions(id);
  }

  @Get('schedule-requests/:id/comparison')
  comparison(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.alternatives.comparison(id);
  }
}
