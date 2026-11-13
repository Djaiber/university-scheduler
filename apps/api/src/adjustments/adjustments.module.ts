import { Module } from '@nestjs/common';
import { AdjustmentsController } from './adjustments.controller';

@Module({ controllers: [AdjustmentsController] })
export class AdjustmentsModule {}
