import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Usuario que ejecuta la acción. Provisional: cabecera `x-actor` (pruebas y desarrollo local).
 * SCRUM-31 lo reemplaza por la identidad del JWT de Cognito.
 */
export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user?: { sub: string }; headers: Record<string, string | undefined> }>();
  return req.user?.sub ?? req.headers['x-actor'] ?? 'anonymous';
});
