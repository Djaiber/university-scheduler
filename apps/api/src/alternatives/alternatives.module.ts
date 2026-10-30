import { Module } from '@nestjs/common';
import { AlternativesController } from './alternatives.controller';
import { AlternativesService } from './alternatives.service';
import { RevisionsService } from './revisions.service';

@Module({ controllers: [AlternativesController], providers: [AlternativesService, RevisionsService], exports: [AlternativesService, RevisionsService] })
export class AlternativesModule {}
