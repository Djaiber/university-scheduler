import { Module } from '@nestjs/common';
import { AlternativesController } from './alternatives.controller';
import { AlternativesService } from './alternatives.service';

@Module({ controllers: [AlternativesController], providers: [AlternativesService], exports: [AlternativesService] })
export class AlternativesModule {}
