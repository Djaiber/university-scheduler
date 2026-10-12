import { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/http-exception.filter';

/** Configuración común de la app (main.ts y pruebas e2e). */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}
