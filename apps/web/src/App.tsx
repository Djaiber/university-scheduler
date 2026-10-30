import { NavLink, Route, Routes } from 'react-router-dom';
import { AlternativePage } from './pages/AlternativePage';
import { ComparePage } from './pages/ComparePage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { RequestsPage } from './pages/RequestsPage';
import { ROLES, Role, useSession } from './session';

function DevIdentity() {
  const { session, setSession } = useSession();
  if (session.token) return <span className="muted">{session.actor}</span>;
  return (
    <span className="row" aria-label="Identidad de desarrollo">
      <input aria-label="Usuario" value={session.actor} onChange={(e) => setSession({ ...session, actor: e.target.value })} />
      <select aria-label="Rol" value={session.roles[0]} onChange={(e) => setSession({ ...session, roles: [e.target.value as Role] })}>
        {ROLES.map((r) => <option key={r}>{r}</option>)}
      </select>
    </span>
  );
}

export function App() {
  return (
    <>
      <header className="top">
        <h1>Horarios · Panel administrativo</h1>
        <nav><NavLink to="/">Solicitudes</NavLink></nav>
        <DevIdentity />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<RequestsPage />} />
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/requests/:id/compare" element={<ComparePage />} />
          <Route path="/alternatives/:id" element={<AlternativePage />} />
        </Routes>
      </main>
    </>
  );
}
