import { ReactElement } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import type { Role } from '@us/api-client';
import { navFor } from './actors';
import { cognito, login, logoutUrl } from './auth';
import { AdjustmentsPage } from './pages/AdjustmentsPage';
import { AlternativePage } from './pages/AlternativePage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { ComparePage } from './pages/ComparePage';
import { HomePage } from './pages/HomePage';
import { MasterDataPage } from './pages/MasterDataPage';
import { OfferPage } from './pages/OfferPage';
import { PublishedPage } from './pages/PublishedPage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { RequestsPage } from './pages/RequestsPage';
import { RulesPage } from './pages/RulesPage';
import { UsersPage } from './pages/UsersPage';
import { hasRole, ROLE_LABELS, ROLES, useSession } from './session';

function Identity() {
  const { session, setSession, me } = useSession();
  const chips = session.roles.map((r) => <span key={r} className="chip">{ROLE_LABELS[r]}</span>);
  if (cognito) {
    return session.token ? (
      <span className="identity">
        <span className="muted">{me?.display_name ?? session.actor}</span>{chips}
        <button className="secondary" onClick={() => { setSession({ actor: '', roles: [], token: null }); window.location.assign(logoutUrl()!); }}>Salir</button>
      </span>
    ) : <button onClick={() => void login()}>Iniciar sesión</button>;
  }
  return (
    <span className="identity" aria-label="Identidad de desarrollo">
      <input aria-label="Usuario" value={session.actor} onChange={(e) => setSession({ ...session, actor: e.target.value.toLowerCase(), roles: [] })} />
      <select aria-label="Actor" value={session.roles[0] ?? ''} onChange={(e) => setSession({ ...session, roles: e.target.value ? [e.target.value as Role] : [] })}>
        <option value="">(según directorio)</option>
        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
    </span>
  );
}

/** Muestra la pantalla solo a los actores indicados; la API vuelve a verificar cada acción. */
function Only({ roles, children }: { roles: Role[]; children: ReactElement }) {
  const { session } = useSession();
  return hasRole(session, ...roles) ? children : <p className="notice" role="alert">Esta sección no está disponible para su actor.</p>;
}

const STAFF_AND_DIRECTOR: Role[] = ['ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR'];

export function App() {
  const { session } = useSession();
  return (
    <>
      <header className="top">
        <Link to="/" className="brand" aria-label="Inicio">
          <img src="/logo-unbosque-horizontal.png" alt="Universidad El Bosque" />
          <span>Plataforma<br />de horarios</span>
        </Link>
        <nav aria-label="Principal">
          {navFor(session.roles).map((n) => <NavLink key={n.to} to={n.to}>{n.label}</NavLink>)}
        </nav>
        <Identity />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/requests" element={<Only roles={STAFF_AND_DIRECTOR}><RequestsPage /></Only>} />
          <Route path="/requests/:id" element={<Only roles={STAFF_AND_DIRECTOR}><RequestDetailPage /></Only>} />
          <Route path="/requests/:id/compare" element={<Only roles={STAFF_AND_DIRECTOR}><ComparePage /></Only>} />
          <Route path="/alternatives/:id" element={<Only roles={STAFF_AND_DIRECTOR}><AlternativePage /></Only>} />
          <Route path="/offer" element={<Only roles={['DIRECTOR', 'ADMINISTRADOR', 'COMITE_TACTICO']}><OfferPage /></Only>} />
          <Route path="/adjustments" element={<Only roles={STAFF_AND_DIRECTOR}><AdjustmentsPage /></Only>} />
          <Route path="/rules" element={<Only roles={['COMITE_TACTICO', 'ADMINISTRADOR']}><RulesPage /></Only>} />
          <Route path="/data" element={<Only roles={['ADMINISTRADOR']}><MasterDataPage /></Only>} />
          <Route path="/users" element={<Only roles={['ADMINISTRADOR']}><UsersPage /></Only>} />
          <Route path="/availability" element={<Only roles={['DOCENTE']}><AvailabilityPage /></Only>} />
          <Route path="/my-schedule" element={<Only roles={['DOCENTE']}><PublishedPage mine /></Only>} />
          <Route path="/published" element={<PublishedPage />} />
        </Routes>
      </main>
    </>
  );
}
