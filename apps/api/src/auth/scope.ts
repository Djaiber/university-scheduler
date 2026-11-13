import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Queryable } from '../database/database.service';
import { AuthUser, directorProgram } from './auth.types';

/**
 * Un DIRECTOR solo ve las solicitudes de su programa o las institucionales (sin programa). El personal
 * (ADMINISTRADOR, COMITE_TACTICO) no tiene restricción.
 */
export async function assertRequestVisible(q: Queryable, user: AuthUser, requestId: string): Promise<void> {
  const scope = directorProgram(user);
  if (!scope) return;
  const { rows: [r] } = await q.query<{ program_id: string | null }>('SELECT program_id FROM schedule_requests WHERE id = $1', [requestId]);
  if (!r) throw new NotFoundException('Solicitud no encontrada');
  if (r.program_id && r.program_id !== scope) throw new ForbiddenException('La solicitud pertenece a otro programa');
}

export async function assertAlternativeVisible(q: Queryable, user: AuthUser, alternativeId: string): Promise<void> {
  if (!directorProgram(user)) return;
  const { rows: [a] } = await q.query<{ request_id: string }>(
    'SELECT o.request_id FROM schedule_alternatives a JOIN optimization_runs o ON o.id = a.run_id WHERE a.id = $1',
    [alternativeId],
  );
  if (!a) throw new NotFoundException('Alternativa no encontrada');
  await assertRequestVisible(q, user, a.request_id);
}
