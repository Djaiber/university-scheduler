import { useCallback, useEffect, useState } from 'react';
import type { RuleScope, RuleVersion } from '@us/api-client';
import { hasRole, useSession } from '../session';

/**
 * Reglas del COMITÉ TÁCTICO (SCRUM-45). Una versión publicada es inmutable: se crea un borrador a partir
 * de la vigente, se ajustan activaciones, pesos y parámetros, y se publica. Las nuevas generaciones usan la
 * última versión publicada; las ya generadas conservan la suya.
 */
export function RulesPage() {
  const { api, session } = useSession();
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [current, setCurrent] = useState<RuleVersion | null>(null);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const canEdit = hasRole(session, 'COMITE_TACTICO');

  const load = useCallback(async (select?: string) => {
    const vs = await api.listRuleVersions();
    setVersions(vs);
    const target = select ?? vs.find((v) => v.draft)?.id ?? vs[0]?.id;
    if (target) setCurrent(await api.getRuleVersion(target));
  }, [api]);
  useEffect(() => { load().catch((e: Error) => setMsg({ kind: 'error', text: e.message })); }, [load]);

  const run = async (fn: () => Promise<RuleVersion>, ok?: string) => {
    setMsg(null);
    try {
      const v = await fn();
      setCurrent(v);
      if (ok) setMsg({ kind: 'ok', text: ok });
      setVersions(await api.listRuleVersions());
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const editable = Boolean(canEdit && current?.draft);
  const update = (r: RuleScope, body: Parameters<typeof api.updateRule>[2]) => void run(() => api.updateRule(current!.id, r.code, body));

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Comité táctico · reglas</p>
        <h2>Versiones de reglas</h2>
        <div className="row">
          <label>Versión
            <select aria-label="Versión" value={current?.id ?? ''} onChange={(e) => void load(e.target.value)}>
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} {v.draft ? '(borrador)' : `· publicada ${new Date(v.published_at!).toLocaleDateString('es-CO')}`}</option>)}
            </select>
          </label>
          {canEdit && !versions.some((v) => v.draft) && (
            <>
              <label style={{ flex: 1 }}>Motivo del cambio
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. acuerdo del comité del 12 de noviembre" />
              </label>
              <button onClick={() => void run(() => api.createRuleDraft(notes || undefined), 'Borrador creado a partir de la versión vigente.')}>Nuevo borrador</button>
            </>
          )}
          {editable && (
            <button className="accent" onClick={() => void run(() => api.publishRuleVersion(current!.id), `Versión ${current!.version} publicada: aplica a las próximas generaciones.`)}>
              Publicar v{current!.version}
            </button>
          )}
        </div>
        {current && <p className="muted">{current.notes}{current.published_by ? ` · publicada por ${current.published_by}` : ''}</p>}
        {msg && <p className={msg.kind === 'error' ? 'error' : 'success'} role="alert">{msg.text}</p>}
      </section>

      {current?.rules && (
        <section className="panel">
          <table aria-label="Reglas">
            <thead><tr><th>Regla</th><th>Tipo</th><th>Descripción</th><th>Activa</th><th>Peso</th><th>Parámetro</th></tr></thead>
            <tbody>
              {current.rules.map((r) => (
                <tr key={r.code}>
                  <td><code>{r.code}</code></td>
                  <td><span className={`badge ${r.kind === 'HARD' ? 'bad' : 'info'}`}>{r.kind === 'HARD' ? 'Dura' : 'Blanda'}</span></td>
                  <td>{r.description}</td>
                  <td>
                    <input type="checkbox" aria-label={`Activar ${r.code}`} checked={r.enabled} disabled={!editable || r.locked}
                      title={r.locked ? 'Regla dura obligatoria' : ''} onChange={(e) => update(r, { enabled: e.target.checked })} />
                  </td>
                  <td>
                    {r.kind === 'SOFT'
                      ? <input type="number" aria-label={`Peso de ${r.code}`} min={0} max={100} style={{ width: 70 }} defaultValue={r.weight ?? 0} disabled={!editable}
                          key={`${current.id}-${r.code}-${r.weight}`}
                          onBlur={(e) => { const w = Number(e.target.value); if (w !== r.weight) update(r, { weight: w }); }} />
                      : '—'}
                  </td>
                  <td>
                    {r.code === 'S4_COHORT_DAY_LOAD'
                      ? <label className="inline">máx. diarias
                          <input type="number" min={1} max={8} style={{ width: 60 }} defaultValue={r.params.max_daily_sessions_per_cohort ?? 3} disabled={!editable}
                            key={`${current.id}-p-${r.params.max_daily_sessions_per_cohort}`}
                            onBlur={(e) => { const v = Number(e.target.value); if (v !== r.params.max_daily_sessions_per_cohort) update(r, { params: { max_daily_sessions_per_cohort: v } }); }} />
                        </label>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
