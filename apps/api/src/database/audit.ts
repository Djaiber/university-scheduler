import { Queryable } from './database.service';

/** Registra una acción en audit_logs (append-only). Debe llamarse dentro de la misma transacción del cambio. */
export async function audit(
  db: Queryable,
  entry: { actor: string; action: string; entityType: string; entityId: string; reason?: string; before?: unknown; after?: unknown },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs(actor, action, entity_type, entity_id, reason, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entry.actor, entry.action, entry.entityType, entry.entityId, entry.reason ?? null,
     entry.before === undefined ? null : JSON.stringify(entry.before),
     entry.after === undefined ? null : JSON.stringify(entry.after)],
  );
}
