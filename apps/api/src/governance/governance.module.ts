import { Module } from '@nestjs/common';
import { AlternativesModule } from '../alternatives/alternatives.module';
import { GovernanceController } from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({ imports: [AlternativesModule], controllers: [GovernanceController], providers: [GovernanceService] })
export class GovernanceModule {}
