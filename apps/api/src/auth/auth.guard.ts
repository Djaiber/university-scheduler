import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { asRoles, AuthUser, Role } from './auth.types';
import { IS_PUBLIC, REQUIRED_ROLES } from './decorators';

type Req = { headers: Record<string, string | undefined>; user?: AuthUser };

/**
 * Autenticación y autorización por rol (RNF-03, §11).
 * - Con COGNITO_ISSUER: exige JWT de Cognito (firma por JWKS, emisor, expiración); roles = `cognito:groups`.
 * - Sin COGNITO_ISSUER (desarrollo y pruebas): cabeceras `x-actor` y `x-roles`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks;

  constructor(private readonly reflector: Reflector, @Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.jwks = config.cognitoIssuer ? createRemoteJWKSet(new URL(`${config.cognitoIssuer}/.well-known/jwks.json`)) : null;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    req.user = this.jwks ? await this.fromJwt(req) : this.fromDevHeaders(req);

    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required?.length && !req.user.roles.includes('ADMIN') && !required.some((r) => req.user!.roles.includes(r))) {
      throw new ForbiddenException(`Requiere uno de los roles: ${required.join(', ')}`);
    }
    return true;
  }

  private async fromJwt(req: Req): Promise<AuthUser> {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Falta el token de acceso');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks!, { issuer: this.config.cognitoIssuer }));
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    return {
      sub: String(payload.email ?? payload['cognito:username'] ?? payload.sub),
      email: payload.email as string | undefined,
      roles: asRoles(payload['cognito:groups']),
    };
  }

  private fromDevHeaders(req: Req): AuthUser {
    const roles = req.headers['x-roles'] ?? process.env.DEV_DEFAULT_ROLES ?? '';
    return { sub: req.headers['x-actor'] ?? 'anonymous', roles: asRoles(roles) };
  }
}
