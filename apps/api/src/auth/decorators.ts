import { SetMetadata } from '@nestjs/common';
import { Role } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_ROLES = 'auth:roles';

/** Endpoint sin autenticación (solo /health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Roles autorizados (cualquiera de ellos). ADMIN siempre está autorizado. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);
