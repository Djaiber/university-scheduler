import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AlternativesModule } from './alternatives/alternatives.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { QueueModule } from './queue/queue.module';
import { RequestsModule } from './requests/requests.module';

@Module({
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
  imports: [ConfigModule, DatabaseModule, HealthModule, QueueModule, CatalogModule, ImportsModule, RequestsModule, AlternativesModule] })
export class AppModule {}
