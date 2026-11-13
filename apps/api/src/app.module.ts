import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AdjustmentsModule } from './adjustments/adjustments.module';
import { AlternativesModule } from './alternatives/alternatives.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GovernanceModule } from './governance/governance.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { OffersModule } from './offers/offers.module';
import { PortalModule } from './portal/portal.module';
import { QueueModule } from './queue/queue.module';
import { RequestsModule } from './requests/requests.module';
import { RulesModule } from './rules/rules.module';
import { UsersModule } from './users/users.module';

@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  imports: [ConfigModule, DatabaseModule, HealthModule, QueueModule, CatalogModule, ImportsModule, RequestsModule, AlternativesModule, GovernanceModule,
    UsersModule, OffersModule, AdjustmentsModule, RulesModule, PortalModule],
})
export class AppModule {}
