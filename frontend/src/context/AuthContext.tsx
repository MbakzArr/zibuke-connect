import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { apiRequest, setTokens, getAccessToken } from '../api/client';

// Holds the logged-in user and exposes login/logout to the whole app.
// Anything that needs to know "who am I" reads from here.

interface User {
  id: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first load, if we have a token, confirm it's still valid by asking
  // the backend who we are. This keeps the session across page refreshes.
  useEffect(() => {
    async function restore() {
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await apiRequest('/api/v1/me');
        // /me returns the decoded token; map it to our user shape.
        setUser({ id: data.user.userId, email: '', role: data.user.role });
      } catch {
        setTokens(null, null);
      } finally {
        setLoading(false);
      }
    }
    restore();
  }, []);

  async function login(email: string, password: string) {
    // retryOn401: false - login is a fresh attempt with no session to
    // refresh. Without this, a wrong password (a normal 401) triggers
    // the same auto-refresh-then-"session expired" flow built for an
    // authenticated request whose token died mid-session - which doesn't
    // apply here at all, and ends up hiding the real reason (wrong
    // email/password) behind a confusing, unrelated message.
    const data = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
      retryOn401: false,
    });
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }

  function logout() {
    setTokens(null, null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
