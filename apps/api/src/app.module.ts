import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';

@Module({ imports: [ConfigModule, DatabaseModule, HealthModule, CatalogModule, ImportsModule] })
export class AppModule {}
