import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Usuario que ejecuta la acción, resuelto por AuthGuard (JWT de Cognito o cabeceras de desarrollo). */
export const Actor = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ user?: { sub: string }; headers: Record<string, string | undefined> }>();
  return req.user?.sub ?? req.headers['x-actor'] ?? 'anonymous';
});
