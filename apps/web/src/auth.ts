/**
 * Inicio de sesión con Cognito (Authorization Code + PKCE, cliente público definido en terraform/modules/auth).
 * Se activa si existen VITE_COGNITO_DOMAIN y VITE_COGNITO_CLIENT_ID; si no, el panel usa la identidad de desarrollo.
 */
import type { Role, Session } from './session';

const env = import.meta.env;
export const cognito = env.VITE_COGNITO_DOMAIN && env.VITE_COGNITO_CLIENT_ID
  ? { domain: env.VITE_COGNITO_DOMAIN, clientId: env.VITE_COGNITO_CLIENT_ID }
  : null;

const redirectUri = () => `${window.location.origin}/auth/callback`;
const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function login(): Promise<void> {
  if (!cognito) return;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem('pkce', JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: cognito.clientId, redirect_uri: redirectUri(), scope: 'openid email profile',
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  window.location.assign(`https://${cognito.domain}/oauth2/authorize?${q}`);
}

/** Decodifica (sin verificar: la API verifica la firma) el payload de un JWT. */
export function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(escape(atob(part))));
}

export function sessionFromIdToken(idToken: string): Session {
  const claims = decodeJwt(idToken);
  const groups = Array.isArray(claims['cognito:groups']) ? (claims['cognito:groups'] as Role[]) : [];
  return { actor: String(claims.email ?? claims.sub), roles: groups, token: idToken };
}

export async function completeLogin(search: string): Promise<Session> {
  if (!cognito) throw new Error('Cognito no configurado');
  const params = new URLSearchParams(search);
  const saved = JSON.parse(sessionStorage.getItem('pkce') ?? '{}');
  if (!params.get('code') || params.get('state') !== saved.state) throw new Error('Respuesta de inicio de sesión inválida');
  const res = await fetch(`https://${cognito.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: cognito.clientId, code: params.get('code')!,
      redirect_uri: redirectUri(), code_verifier: saved.verifier,
    }),
  });
  if (!res.ok) throw new Error(`Cognito respondió ${res.status}`);
  const tokens = (await res.json()) as { id_token: string };
  sessionStorage.removeItem('pkce');
  return sessionFromIdToken(tokens.id_token);
}

export function logoutUrl(): string | null {
  if (!cognito) return null;
  return `https://${cognito.domain}/logout?${new URLSearchParams({ client_id: cognito.clientId, logout_uri: window.location.origin })}`;
}
