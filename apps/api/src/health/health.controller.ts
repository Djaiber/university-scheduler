import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Usado por el target group del ALB (terraform/modules/compute). */
  @Get()
  async check(): Promise<{ status: string; database: string; version: string }> {
    const ok = await this.db.ping();
    if (!ok) throw new ServiceUnavailableException({ status: 'degraded', database: 'down', version: this.config.version });
    return { status: 'ok', database: 'up', version: this.config.version };
  }
}
