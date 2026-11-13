import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser, Role } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';

/** Endpoint sin autenticación (solo /health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Actores autorizados (cualquiera de ellos). Sin @Roles, basta con estar autenticado. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

/** Usuario autenticado con sus roles efectivos y su alcance (programa, docente, cohorte). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  return req.user ?? { sub: 'anonymous', roles: [] };
});
