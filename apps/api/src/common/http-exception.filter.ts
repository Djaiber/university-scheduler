import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

/** Respuestas de error homogéneas: { statusCode, error, message, details? }. Nunca filtra trazas al cliente. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      res.status(status).json({ statusCode: status, error: HttpStatus[status] ?? 'Error', ...payload });
      return;
    }
    // Errores de PostgreSQL de reglas de gobierno (triggers) → 409 con el mensaje del trigger
    const pg = exception as { code?: string; message?: string };
    if (pg?.code === '23000' || pg?.code === '23514' || pg?.code === '23505') {
      res.status(409).json({ statusCode: 409, error: 'Conflict', message: pg.message, code: pg.code });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: 'Error interno' });
  }
}
