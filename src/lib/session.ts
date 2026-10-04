// Wallet sign-in: the user signs a one-time message (no gas) and gets a 7-day session token.
import { api } from './api';

const key = (a: string) => `quantly.admin.admin.session.${a.toLowerCase()}`; // separate from the public site

function decodeExp(token: string): number {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000;
  } catch {
    return 0;
  }
}

export function getSession(address?: string | null): string | null {
  if (!address) return null;
  try {
    const token = localStorage.getItem(key(address));
    if (token && decodeExp(token) > Date.now() + 60_000) return token;
  } catch {}
  return null;
}

export async function ensureSession(address: string, signMessage: (message: string) => Promise<string>): Promise<string> {
  const existing = getSession(address);
  if (existing) return existing;
  const { message } = await api.post<{ message: string }>('/auth/nonce', { address });
  // Only ever sign a standard sign-in message for THIS site and THIS wallet (never arbitrary text from the API).
  assertSignInMessage(message, address);
  const signature = await signMessage(message);
  const { token } = await api.post<{ token: string }>('/auth/verify', { address, message, signature });
  try {
    localStorage.setItem(key(address), token);
  } catch {}
  return token;
}

export function assertSignInMessage(message: string, address: string) {
  const lines = String(message || '').split('\n');
  const ok =
    lines[0] === `${window.location.host} wants you to sign in with your wallet:` &&
    lines[1]?.toLowerCase() === address.toLowerCase() &&
    lines.includes(`URI: ${window.location.origin}`) &&
    lines.length === 11;
  if (!ok) throw new Error('The sign-in request looks wrong, so it was not sent to your wallet. Reload the page and try again.');
}

const RETRY_CODES = new Set(['auth_expired', 'auth_required', 'auth_stale', 'admin_session']);

/** Runs an API call with the session; if the server says the session is no longer valid, signs in again once. */
export async function withSession<T>(address: string, signMessage: (message: string) => Promise<string>, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await ensureSession(address, signMessage));
  } catch (e: any) {
    if (e?.status !== 401 || !RETRY_CODES.has(e?.code)) throw e;
    clearSession(address);
    return fn(await ensureSession(address, signMessage));
  }
}

export function clearSession(address?: string | null) {
  if (!address) return;
  try {
    localStorage.removeItem(key(address));
  } catch {}
}
