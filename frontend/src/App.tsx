import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Workspace from './pages/Workspace';

// Top-level gate: while we check the stored token, show nothing; then either
// the login screen or the workspace depending on whether we have a user.
export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 40, color: '#8a8aa3' }}>Loading...</div>;
  }

  return user ? <Workspace /> : <Login />;
}
