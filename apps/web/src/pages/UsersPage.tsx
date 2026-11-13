import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { DirectoryUser, InvitationStatus, Role, UserInput } from '@us/api-client';
import { ROLE_LABELS, ROLES, useSession } from '../session';

const EMPTY = { email: '', display_name: '', roles: [] as Role[], program: '', teacher: '', cohort: '', active: true };

/**
 * Directorio de usuarios (ADMINISTRADOR). La cuenta de acceso existe en Cognito; aquí se asigna el actor
 * y su alcance: programa para DIRECTOR y ESTUDIANTE, docente para DOCENTE, cohorte opcional para ESTUDIANTE.
 */
export function UsersPage() {
  const { api, me } = useSession();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [teachers, setTeachers] = useState<{ code: string; full_name: string }[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(() => api.listUsers().then(setUsers), [api]);
  useEffect(() => {
    load().catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
    api.listPrograms().then((p) => setPrograms(p.map((x) => x.code))).catch(() => undefined);
    api.listTeachers().then(setTeachers).catch(() => undefined);
  }, [api, load]);

  const needs = {
    program: form.roles.includes('DIRECTOR') || form.roles.includes('ESTUDIANTE'),
    teacher: form.roles.includes('DOCENTE'),
    cohort: form.roles.includes('ESTUDIANTE'),
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body: UserInput = {
      roles: form.roles,
      active: form.active,
      ...(form.display_name ? { display_name: form.display_name } : {}),
      program: needs.program ? form.program || null : null,
      teacher: needs.teacher ? form.teacher || null : null,
      cohort: needs.cohort ? form.cohort || null : null,
    };
    try {
      const saved = await api.saveUser(form.email, body);
      setMsg(invitationMessage(saved.email, saved.invitation, `Usuario ${saved.email} guardado.`));
      setForm(EMPTY);
      await load();
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    }
  }

  const edit = (u: DirectoryUser) => setForm({
    email: u.email, display_name: u.display_name ?? '', roles: u.roles, program: u.program ?? '', teacher: u.teacher ?? '',
    cohort: u.cohort ?? '', active: u.active,
  });
  const toggle = (r: Role) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Administrador · usuarios</p>
        <h2>{form.email && users.some((u) => u.email === form.email) ? `Editar ${form.email}` : 'Agregar usuario'}</h2>
        <form onSubmit={submit} aria-label="Usuario" style={{ display: 'grid', gap: 12 }}>
          <div className="row">
            <label>Correo institucional
              <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.toLowerCase() })} placeholder="nombre@unbosque.edu.co" />
            </label>
            <label>Nombre
              <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </label>
            <label className="inline"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Activo</label>
          </div>
          <fieldset className="row" style={{ border: 'none', padding: 0 }}>
            <legend className="muted" style={{ marginBottom: 6 }}>Actor</legend>
            {ROLES.map((r) => (
              <label key={r} className="inline"><input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggle(r)} /> {ROLE_LABELS[r]}</label>
            ))}
          </fieldset>
          <div className="row">
            {needs.program && (
              <label>Programa
                <select required value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })}>
                  <option value="">—</option>
                  {programs.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
            )}
            {needs.teacher && (
              <label>Docente vinculado
                <select required value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })}>
                  <option value="">—</option>
                  {teachers.map((t) => <option key={t.code} value={t.code}>{t.full_name} ({t.code})</option>)}
                </select>
              </label>
            )}
            {needs.cohort && (
              <label>Cohorte (opcional)
                <input value={form.cohort} onChange={(e) => setForm({ ...form, cohort: e.target.value })} placeholder="SIS-1A" />
              </label>
            )}
            <button type="submit" disabled={!form.email}>Guardar</button>
            {form.email && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Limpiar</button>}
          </div>
          <p className="muted">Al guardar un usuario nuevo se le envía un correo con su contraseña temporal; el actor asignado aquí se suma a sus grupos de Cognito.</p>
        </form>
        {msg && <p className={msg.kind === 'error' ? 'error' : 'success'} role="alert">{msg.text}</p>}
      </section>

      <section className="panel">
        <h2>Directorio ({users.length})</h2>
        <table aria-label="Directorio de usuarios">
          <thead><tr><th>Correo</th><th>Nombre</th><th>Actor</th><th>Alcance</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email}>
                <td>{u.email}{u.email === me?.email && <span className="chip accent" style={{ marginLeft: 6 }}>usted</span>}</td>
                <td>{u.display_name ?? '—'}</td>
                <td>{u.roles.map((r) => <span key={r} className="chip" style={{ marginRight: 4 }}>{ROLE_LABELS[r]}</span>)}</td>
                <td>{[u.program && `Programa ${u.program}`, u.teacher_name && `Docente ${u.teacher_name}`, u.cohort && `Cohorte ${u.cohort}`].filter(Boolean).join(' · ') || '—'}</td>
                <td>{u.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                <td>
                  <button className="link" onClick={() => edit(u)}>Editar</button>
                  {u.active && (
                    <button className="link" style={{ marginLeft: 12 }} aria-label={`Reenviar invitación a ${u.email}`}
                      onClick={() => api.resendInvitation(u.email)
                        .then((r) => setMsg(invitationMessage(r.email, r.invitation)))
                        .catch((e: Error) => setMsg({ kind: 'error', text: e.message }))}>
                      Reenviar invitación
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Texto para el administrador según lo que hizo Cognito con la cuenta. */
export function invitationMessage(email: string, status: InvitationStatus | undefined, prefix = ''): { kind: 'ok' | 'error'; text: string } {
  const lead = prefix ? `${prefix} ` : '';
  switch (status) {
    case 'SENT': return { kind: 'ok', text: `${lead}Se envió a ${email} un correo con su contraseña temporal.` };
    case 'RESENT': return { kind: 'ok', text: `${lead}Se reenvió a ${email} la invitación con una contraseña temporal nueva.` };
    case 'ALREADY_ACTIVE': return { kind: 'ok', text: `${lead}${email} ya activó su cuenta; puede usar «¿Olvidó su contraseña?» en el inicio de sesión.` };
    case 'FAILED': return { kind: 'error', text: `${lead}No se pudo enviar la invitación a ${email}. Use «Reenviar invitación».` };
    default: return { kind: 'ok', text: prefix || `Sin envío de correo en este entorno (${email}).` };
  }
}
