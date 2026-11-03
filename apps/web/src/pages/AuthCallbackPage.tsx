import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { completeLogin } from '../auth';
import { useSession } from '../session';

export function AuthCallbackPage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    completeLogin(window.location.search)
      .then((s) => { setSession(s); navigate('/', { replace: true }); })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return error ? <p className="error" role="alert">{error}</p> : <p className="muted">Iniciando sesión…</p>;
}
