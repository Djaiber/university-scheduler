import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { AuthUser, ROLES, Role } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { SchemaValidationPipe } from '../common/schema-validation.pipe';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';

interface UserBody {
  display_name?: string;
  roles: Role[];
  program?: string | null;
  teacher?: string | null;
  cohort?: string | null;
  active?: boolean;
}

const userSchema = {
  type: 'object', additionalProperties: false, required: ['roles'],
  properties: {
    display_name: { type: 'string', maxLength: 120 },
    roles: { type: 'array', uniqueItems: true, maxItems: 5, items: { enum: [...ROLES] } },
    program: { type: ['string', 'null'], maxLength: 20 },
    teacher: { type: ['string', 'null'], maxLength: 40 },
    cohort: { type: ['string', 'null'], maxLength: 60 },
    active: { type: 'boolean' },
  },
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SELECT = `SELECT u.email, u.display_name, u.roles::text[] AS roles, p.code AS program, t.external_code AS teacher,
                       t.full_name AS teacher_name, u.cohort, u.active, u.updated_by, u.updated_at
                  FROM app_users u LEFT JOIN programs p ON p.id = u.program_id LEFT JOIN teachers t ON t.id = u.teacher_id`;

/**
 * Identidad y directorio de usuarios (SCRUM-43). La cuenta de acceso la da Cognito; el ADMINISTRADOR
 * asigna aquí el actor y su alcance: programa (DIRECTOR, ESTUDIANTE), docente (DOCENTE) y cohorte (ESTUDIANTE).
 */
@Controller()
export class UsersController {
  constructor(private readonly db: DatabaseService) {}

  /** Quién soy: roles efectivos y alcance. El panel decide qué pantallas mostrar con esto. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return {
      email: user.sub,
      display_name: user.displayName ?? null,
      roles: user.roles,
      program: user.programCode ?? null,
      teacher: user.teacherCode ?? null,
      cohort: user.cohort ?? null,
    };
  }

  @Get('users')
  @Roles('ADMINISTRADOR')
  list() {
    return this.db.query(`${SELECT} ORDER BY u.email`);
  }

  @Get('teachers')
  @Roles('ADMINISTRADOR')
  teachers() {
    return this.db.query('SELECT external_code AS code, full_name, email, active FROM teachers ORDER BY full_name');
  }

  @Put('users/:email')
  @Roles('ADMINISTRADOR')
  upsert(@Param('email') rawEmail: string, @Body(new SchemaValidationPipe<UserBody>(userSchema)) b: UserBody, @CurrentUser() admin: AuthUser) {
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('Correo inválido');
    if (email === admin.sub && (b.active === false || !b.roles.includes('ADMINISTRADOR'))) {
      throw new BadRequestException('Un administrador no puede quitarse su propio acceso de administrador');
    }
    return this.db.tx(async (tx) => {
      const programId = await this.lookup(tx, 'programs', 'code', b.program, 'Programa');
      const teacherId = await this.lookup(tx, 'teachers', 'external_code', b.teacher, 'Docente');
      const { rows: [before] } = await tx.query(`${SELECT} WHERE u.email = $1`, [email]);
      // Las restricciones app_users_*_scope exigen el alcance de cada actor (409 si falta)
      await tx.query(
        `INSERT INTO app_users(id, email, display_name, roles, program_id, teacher_id, cohort, active, updated_by, updated_at)
         VALUES ($1, $1, $2, $3::app_role[], $4, $5, $6, $7, $8, now())
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, roles = EXCLUDED.roles,
           program_id = EXCLUDED.program_id, teacher_id = EXCLUDED.teacher_id, cohort = EXCLUDED.cohort,
           active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [email, b.display_name ?? null, b.roles, programId, teacherId, b.cohort ?? null, b.active ?? true, admin.sub],
      );
      const { rows: [after] } = await tx.query(`${SELECT} WHERE u.email = $1`, [email]);
      await audit(tx, { actor: admin.sub, action: before ? 'USER_UPDATED' : 'USER_CREATED', entityType: 'app_user', entityId: email,
        before: before ?? undefined, after });
      return after;
    });
  }

  private async lookup(q: Queryable, table: 'programs' | 'teachers', column: string, value: string | null | undefined, label: string) {
    if (!value) return null;
    const { rows: [row] } = await q.query<{ id: string }>(`SELECT id FROM ${table} WHERE ${column} = $1`, [value]);
    if (!row) throw new BadRequestException(`${label} ${value} no existe`);
    return row.id;
  }
}
