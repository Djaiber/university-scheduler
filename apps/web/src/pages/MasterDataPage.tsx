import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSession } from '../session';

const ENTITIES = [
  ['time_slots', 'Franjas horarias'],
  ['teachers', 'Docentes'],
  ['classrooms', 'Aulas'],
  ['courses', 'Asignaturas'],
  ['groups', 'Grupos (oferta)'],
  ['teacher_availability', 'Disponibilidad docente'],
  ['classroom_availability', 'Disponibilidad de aulas'],
] as const;

type ImportResult = Awaited<ReturnType<ReturnType<typeof useSession>['api']['importCsv']>>;

/** Datos maestros (ADMINISTRADOR): períodos, programas y cargas CSV en el orden recomendado. */
export function MasterDataPage() {
  const { api } = useSession();
  const [periods, setPeriods] = useState<{ code: string; starts_on: string; ends_on: string }[]>([]);
  const [programs, setPrograms] = useState<{ code: string; name: string; faculty: string }[]>([]);
  const [period, setPeriod] = useState({ code: '', starts_on: '', ends_on: '' });
  const [program, setProgram] = useState({ code: '', name: '', faculty: '' });
  const [upload, setUpload] = useState<{ entity: string; period: string; file: File | null }>({ entity: 'time_slots', period: '', file: null });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const ps = await api.listPeriods();
    setPeriods(ps);
    setUpload((u) => ({ ...u, period: u.period || ps[0]?.code || '' }));
    setPrograms(await api.listPrograms());
  }, [api]);
  useEffect(() => { load().catch((e: Error) => setMsg({ kind: 'error', text: e.message })); }, [load]);

  const run = async (e: FormEvent, fn: () => Promise<unknown>, ok: string) => {
    e.preventDefault();
    setMsg(null);
    try {
      await fn();
      setMsg({ kind: 'ok', text: ok });
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  };

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Administrador · datos maestros</p>
        <h2>Períodos y programas</h2>
        {msg && <p className={msg.kind === 'error' ? 'error' : 'success'} role="alert">{msg.text}</p>}
        <div className="grid-compare">
          <div>
            <h3>Períodos académicos</h3>
            <ul>{periods.map((p) => <li key={p.code}><strong>{p.code}</strong> <span className="muted">{p.starts_on.slice(0, 10)} → {p.ends_on.slice(0, 10)}</span></li>)}</ul>
            <form className="row" aria-label="Nuevo período"
              onSubmit={(e) => void run(e, () => api.createPeriod(period).then(() => setPeriod({ code: '', starts_on: '', ends_on: '' })), `Período ${period.code} creado.`)}>
              <label>Código<input required pattern="[0-9]{4}-[12]" placeholder="2027-2" value={period.code} onChange={(e) => setPeriod({ ...period, code: e.target.value })} /></label>
              <label>Inicio<input required type="date" value={period.starts_on} onChange={(e) => setPeriod({ ...period, starts_on: e.target.value })} /></label>
              <label>Fin<input required type="date" value={period.ends_on} onChange={(e) => setPeriod({ ...period, ends_on: e.target.value })} /></label>
              <button type="submit">Crear período</button>
            </form>
          </div>
          <div>
            <h3>Programas</h3>
            <ul>{programs.map((p) => <li key={p.code}><strong>{p.code}</strong> {p.name} <span className="muted">· {p.faculty}</span></li>)}</ul>
            <form className="row" aria-label="Nuevo programa"
              onSubmit={(e) => void run(e, () => api.createProgram(program).then(() => setProgram({ code: '', name: '', faculty: '' })), `Programa ${program.code} creado.`)}>
              <label>Código<input required value={program.code} onChange={(e) => setProgram({ ...program, code: e.target.value.toUpperCase() })} /></label>
              <label>Nombre<input required value={program.name} onChange={(e) => setProgram({ ...program, name: e.target.value })} /></label>
              <label>Facultad<input required value={program.faculty} onChange={(e) => setProgram({ ...program, faculty: e.target.value })} /></label>
              <button type="submit">Crear programa</button>
            </form>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Cargar datos (CSV)</h2>
        <p className="muted">Orden recomendado: franjas → docentes → aulas → asignaturas → grupos → disponibilidades. Plantillas y diccionario en <code>data/templates</code>.</p>
        <form className="row" aria-label="Cargar CSV"
          onSubmit={(e) => void run(e, async () => { setResult(await api.importCsv(upload.entity, upload.period, upload.file!)); }, 'Archivo procesado.')}>
          <label>Entidad
            <select value={upload.entity} onChange={(e) => setUpload({ ...upload, entity: e.target.value })}>
              {ENTITIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Período
            <select value={upload.period} onChange={(e) => setUpload({ ...upload, period: e.target.value })}>
              {periods.map((p) => <option key={p.code}>{p.code}</option>)}
            </select>
          </label>
          <label>Archivo<input type="file" accept=".csv,text/csv" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} /></label>
          <button type="submit" disabled={!upload.file || !upload.period}>Cargar</button>
        </form>
        {result && (
          <div style={{ marginTop: 12 }}>
            <p>{result.entity}: <span className={`badge ${result.status === 'APPLIED' ? 'ok' : 'bad'}`}>{result.status}</span> · {result.total_rows} filas · {result.error_rows} con error</p>
            {result.errors.length > 0 && (
              <table aria-label="Errores de la carga">
                <thead><tr><th>Fila</th><th>Columna</th><th>Error</th></tr></thead>
                <tbody>{result.errors.map((er, i) => <tr key={i}><td>{er.row}</td><td>{er.column ?? '—'}</td><td>{er.message}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </>
  );
}
