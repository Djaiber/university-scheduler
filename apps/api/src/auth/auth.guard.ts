import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DatabaseService } from '../database/database.service';
import { asRoles, AuthUser, Role } from './auth.types';
import { IS_PUBLIC, REQUIRED_ROLES } from './decorators';

type Req = { headers: Record<string, string | undefined>; user?: AuthUser };

interface DirectoryRow {
  display_name: string | null;
  roles: string[] | string;
  active: boolean;
  program_id: string | null;
  program_code: string | null;
  teacher_id: string | null;
  teacher_code: string | null;
  cohort: string | null;
}

/**
 * Autenticación y autorización por actor (RNF-03, §11, SCRUM-43).
 * - Identidad: con COGNITO_ISSUER exige JWT de Cognito (firma por JWKS, emisor, expiración); sin él
 *   (desarrollo y pruebas) usa las cabeceras `x-actor` y `x-roles`.
 * - Roles efectivos = grupos de Cognito (o `x-roles`) ∪ roles del directorio `app_users`.
 * - El alcance (programa, docente, cohorte) sale del directorio, que administra el ADMINISTRADOR.
 * - Un usuario desactivado en el directorio no entra aunque conserve grupos en Cognito.
 * - No existe un rol que se salte los demás: cada endpoint declara los actores que lo pueden usar.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks;

  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: DatabaseService,
  ) {
    this.jwks = config.cognitoIssuer ? createRemoteJWKSet(new URL(`${config.cognitoIssuer}/.well-known/jwks.json`)) : null;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const identity = this.jwks ? await this.fromJwt(req) : this.fromDevHeaders(req);
    req.user = await this.withDirectory(identity);

    const required = this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, targets);
    if (required?.length && !required.some((r) => req.user!.roles.includes(r))) {
      throw new ForbiddenException(`Requiere uno de los actores: ${required.join(', ')}`);
    }
    return true;
  }

  private async withDirectory(user: AuthUser): Promise<AuthUser> {
    const [row] = await this.db.query<DirectoryRow>(
      `SELECT u.display_name, u.roles::text[] AS roles, u.active, u.program_id, p.code AS program_code,
              u.teacher_id, t.external_code AS teacher_code, u.cohort
         FROM app_users u LEFT JOIN programs p ON p.id = u.program_id LEFT JOIN teachers t ON t.id = u.teacher_id
        WHERE u.email = $1`,
      [user.sub],
    );
    if (!row) return user;
    if (!row.active) throw new ForbiddenException('Usuario desactivado en el directorio');
    return {
      ...user,
      displayName: row.display_name ?? undefined,
      roles: asRoles([...user.roles, ...asRoles(row.roles)]),
      programId: row.program_id ?? undefined,
      programCode: row.program_code ?? undefined,
      teacherId: row.teacher_id ?? undefined,
      teacherCode: row.teacher_code ?? undefined,
      cohort: row.cohort ?? undefined,
    };
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
      sub: String(payload.email ?? payload['cognito:username'] ?? payload.sub).toLowerCase(),
      email: payload.email as string | undefined,
      roles: asRoles(payload['cognito:groups']),
    };
  }

  private fromDevHeaders(req: Req): AuthUser {
    const roles = req.headers['x-roles'] ?? process.env.DEV_DEFAULT_ROLES ?? '';
    return { sub: (req.headers['x-actor'] ?? 'anonymous').toLowerCase(), roles: asRoles(roles) };
  }
}
