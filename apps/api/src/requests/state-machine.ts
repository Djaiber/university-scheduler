import { ConflictException } from '@nestjs/common';
import { canTransition, JobStatus } from '@us/shared-types';
import { audit } from '../database/audit';
import { Queryable } from '../database/database.service';

/**
 * Cambia el estado de una solicitud respetando JOB_TRANSITIONS (§4.3 del plan).
 * Bloquea la fila (FOR UPDATE) para que dos transiciones concurrentes no se pisen.
 */
export async function transitionRequest(
  tx: Queryable,
  requestId: string,
  to: JobStatus,
  actor: string,
  reason?: string,
): Promise<{ from: JobStatus; to: JobStatus }> {
  const { rows } = await tx.query<{ status: JobStatus }>('SELECT status FROM schedule_requests WHERE id = $1 FOR UPDATE', [requestId]);
  if (rows.length === 0) throw new ConflictException(`Solicitud ${requestId} inexistente`);
  const from = rows[0].status;
  if (!canTransition(from, to)) {
    throw new ConflictException({ message: `Transición no permitida: ${from} → ${to}`, from, to });
  }
  await tx.query('UPDATE schedule_requests SET status = $2 WHERE id = $1', [requestId, to]);
  await audit(tx, { actor, action: 'STATUS_CHANGED', entityType: 'schedule_request', entityId: requestId, reason, before: { status: from }, after: { status: to } });
  return { from, to };
}
