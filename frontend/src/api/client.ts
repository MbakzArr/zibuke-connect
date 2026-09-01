// Single API client for the whole app. Every request goes through here so
// there's one place that attaches the access token, sets JSON headers, and
// handles a expired-token refresh. Components never call fetch directly.

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem('accessToken', access);
  else localStorage.removeItem('accessToken');
  if (refresh) localStorage.setItem('refreshToken', refresh);
  else localStorage.removeItem('refreshToken');
}

export function getAccessToken() {
  return accessToken;
}

// Try to get a new access token using the refresh token. Returns true if it
// worked. Called automatically when a request comes back 401.
//
// SINGLE-FLIGHT: if the hub (or anything else) fires several requests at
// once and the token happens to be expired, EVERY one of them hits 401 at
// roughly the same moment. Without this, each would independently call
// /auth/refresh, racing each other. inFlightRefresh makes every caller
// share the same one refresh attempt instead.
let inFlightRefresh: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = doRefresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

async function doRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.accessToken, refreshToken);
    return true;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  retryOn401?: boolean;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, retryOn401 = true } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // If the token expired, refresh once and retry the same request.
  if (res.status === 401 && retryOn401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retryOn401: false });
    }
    // Refresh failed, force logout by clearing tokens.
    setTokens(null, null);
    throw new Error('Session expired, please log in again');
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody.error || `Request failed (${res.status})`;
    // Traceable diagnostic: when a hub load or any batched call fails, this
    // pinpoints exactly which endpoint and status caused it, instead of a
    // generic "something failed" with no way to tell which one.
    console.error(`API error [${method} ${path}] ${res.status}: ${message}`);
    throw new Error(message);
  }

  // 204 No Content has no body.
  if (res.status === 204) return undefined as T;
  return res.json();
}

export { BASE_URL };
