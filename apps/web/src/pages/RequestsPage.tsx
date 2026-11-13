import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NewScheduleRequest, OfferStatus, ScheduleRequestSummary } from '@us/api-client';
import { OfferStateBadge } from './OfferPage';
import { StatusBadge } from '../components/StatusBadge';
import { usePeriods } from '../hooks/usePeriods';
import { hasRole, useSession } from '../session';

const PROFILES = {
  balanced: 'Balanceado',
  teacher_friendly: 'Preferencias docentes',
  compact: 'Jornadas compactas',
  room_efficient: 'Uso eficiente de aulas',
} as const;

type Form = Required<Pick<NewScheduleRequest, 'alternatives_requested' | 'optimization_profile' | 'time_limit_seconds'>> & { program: string };

/**
 * Solicitudes de generación. El ADMINISTRADOR lanza la generación cuando la oferta de cada programa incluido
 * está consolidada por su director; el comité y los directores ven el listado.
 */
export function RequestsPage() {
  const { api, session } = useSession();
  const navigate = useNavigate();
  const { periods, period, setPeriod } = usePeriods();
  const [items, setItems] = useState<ScheduleRequestSummary[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [offers, setOffers] = useState<OfferStatus[]>([]);
  const [form, setForm] = useState<Form>({ program: '', alternatives_requested: 4, optimization_profile: 'balanced', time_limit_seconds: 120 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreate = hasRole(session, 'ADMINISTRADOR');

  useEffect(() => {
    api.listRequests().then(setItems).catch((e: Error) => setError(e.message));
    api.listPrograms().then((ps) => setPrograms(ps.map((p) => p.code))).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    if (!canCreate || !period) return;
    api.offers(period).then((o) => setOffers(o.programs)).catch(() => setOffers([]));
  }, [api, canCreate, period]);

  const included = offers.filter((o) => !form.program || o.program === form.program);
  const pending = included.filter((o) => o.state !== 'CONSOLIDADA');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { program, ...rest } = form;
      const created = await api.createRequest({ period, ...rest, ...(program ? { program } : {}) });
      navigate(`/requests/${created.request_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canCreate && (
        <section className="panel">
          <p className="eyebrow">Administrador</p>
          <h2>Generar alternativas de horario</h2>
          <form className="row" onSubmit={submit} aria-label="Nueva solicitud">
            <label>Período
              <select value={period} onChange={(e) => setPeriod(e.target.value)} required>
                {periods.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label>Programa
              <select value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}>
                <option value="">Todos (institucional)</option>
                {programs.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label>Alternativas
              <input type="number" min={1} max={4} value={form.alternatives_requested}
                onChange={(e) => setForm({ ...form, alternatives_requested: Number(e.target.value) })} />
            </label>
            <label>Perfil
              <select value={form.optimization_profile}
                onChange={(e) => setForm({ ...form, optimization_profile: e.target.value as keyof typeof PROFILES })}>
                {Object.entries(PROFILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>Límite (s)
              <input type="number" min={5} max={3600} value={form.time_limit_seconds}
                onChange={(e) => setForm({ ...form, time_limit_seconds: Number(e.target.value) })} />
            </label>
            <button type="submit" disabled={busy || !period || pending.length > 0}>Generar</button>
          </form>
          {included.length > 0 && (
            <p className="muted" aria-label="Estado de la oferta">
              Oferta: {included.map((o) => <span key={o.program} style={{ marginRight: 10 }}>{o.program} <OfferStateBadge state={o.state} /></span>)}
            </p>
          )}
          {pending.length > 0 && (
            <p className="notice">Falta que la dirección consolide la oferta de {pending.map((p) => p.program).join(', ')} antes de generar.</p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      <section className="panel">
        <h2>Solicitudes</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Período</th><th>Programa</th><th>Estado</th><th>Alternativas</th><th>Perfil</th><th>Solicitó</th></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/requests/${r.id}`}>{new Date(r.created_at).toLocaleString('es-CO')}</Link></td>
                <td>{r.period}</td>
                <td>{r.program ?? 'Institucional'}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.alternatives_requested}</td>
                <td>{PROFILES[r.optimization_profile as keyof typeof PROFILES] ?? r.optimization_profile}</td>
                <td>{r.requested_by}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="muted">Aún no hay solicitudes.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
