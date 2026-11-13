import { Link } from 'react-router-dom';
import { ACTOR_DUTIES, navFor } from '../actors';
import { cognito, login } from '../auth';
import { useSession } from '../session';

/** Inicio: identidad institucional, los actores del proceso y los accesos del usuario. */
export function HomePage() {
  const { session, me } = useSession();
  const signedIn = Boolean(session.token || !cognito);
  const links = navFor(session.roles);

  return (
    <div className="welcome">
      <img src="/logo-unbosque.png" alt="Universidad El Bosque" />
      <h1 style={{ margin: '0 0 6px' }}>Plataforma de horarios</h1>
      <p className="muted">Generación, ajuste, aprobación y publicación de horarios académicos.</p>

      {!signedIn && <button onClick={() => void login()} style={{ marginTop: 12 }}>Iniciar sesión con la cuenta institucional</button>}
      {signedIn && session.roles.length === 0 && (
        <p className="notice" style={{ marginTop: 16 }}>Su cuenta aún no tiene un actor asignado. Solicítelo al administrador de horarios.</p>
      )}
      {signedIn && links.length > 0 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          {links.map((l) => <Link key={l.to} to={l.to} className="btn secondary">{l.label}</Link>)}
        </div>
      )}

      <div className="actors" aria-label="Actores">
        {ACTOR_DUTIES.map((a) => (
          <div key={a.role} style={session.roles.includes(a.role) ? { boxShadow: 'inset 5px 0 0 var(--orange)' } : undefined}>
            <strong>{a.label}</strong>
            <span>{a.duties}{session.roles.includes(a.role) && <span className="chip accent" style={{ marginLeft: 10 }}>{me?.program ?? me?.teacher ?? 'usted'}</span>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
