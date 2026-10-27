import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NewScheduleRequest, ScheduleRequestSummary } from '@us/api-client';
import { StatusBadge } from '../components/StatusBadge';
import { hasRole, useSession } from '../session';

const PROFILES = {
  balanced: 'Balanceado',
  teacher_friendly: 'Preferencias docentes',
  compact: 'Jornadas compactas',
  room_efficient: 'Uso eficiente de aulas',
} as const;

export function RequestsPage() {
  const { api, session } = useSession();
  const navigate = useNavigate();
  const [items, setItems] = useState<ScheduleRequestSummary[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [form, setForm] = useState<Required<Pick<NewScheduleRequest, 'period' | 'alternatives_requested' | 'optimization_profile' | 'time_limit_seconds'>> & { program: string }>({
    period: '', program: '', alternatives_requested: 4, optimization_profile: 'balanced', time_limit_seconds: 120,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listRequests().then(setItems).catch((e: Error) => setError(e.message));
    api.listPeriods().then((ps) => {
      setPeriods(ps.map((p) => p.code));
      setForm((f) => ({ ...f, period: f.period || ps[0]?.code || '' }));
    }).catch(() => undefined);
  }, [api]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { program, ...rest } = form;
      const created = await api.createRequest({ ...rest, ...(program ? { program } : {}) });
      navigate(`/requests/${created.request_id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = hasRole(session, 'COORDINATOR');

  return (
    <>
      <section className="panel">
        <h2>Nueva solicitud de horario</h2>
        {!canCreate && <p className="muted">Solo coordinación puede solicitar generaciones.</p>}
        <form className="row" onSubmit={submit} aria-label="Nueva solicitud">
          <label>Período
            <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} required>
              {periods.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label>Programa (opcional)
            <input value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} placeholder="SIS" />
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
          <button type="submit" disabled={busy || !canCreate || !form.period}>Generar</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="panel">
        <h2>Solicitudes</h2>
        <table>
          <thead>
            <tr><th>Fecha</th><th>Período</th><th>Estado</th><th>Alternativas</th><th>Perfil</th><th>Solicitó</th></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/requests/${r.id}`}>{new Date(r.created_at).toLocaleString('es-CO')}</Link></td>
                <td>{r.period}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.alternatives_requested}</td>
                <td>{PROFILES[r.optimization_profile as keyof typeof PROFILES] ?? r.optimization_profile}</td>
                <td>{r.requested_by}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="muted">Aún no hay solicitudes.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
