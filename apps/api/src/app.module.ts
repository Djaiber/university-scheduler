import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { QueueModule } from './queue/queue.module';
import { RequestsModule } from './requests/requests.module';

@Module({ imports: [ConfigModule, DatabaseModule, HealthModule, QueueModule, CatalogModule, ImportsModule, RequestsModule] })
export class AppModule {}
