import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import './Workspace.css';

export default function Workspace() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!socket) return;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket]);

  return (
    <div className="ws-shell">
      <header className="ws-header">
        <div className="ws-brand">
          <span className="ws-mark">Z</span>
          <span className="ws-name">Zibuke Connect</span>
        </div>
        <div className="ws-header-right">
          <span className={`ws-status ${connected ? 'is-online' : ''}`}>
            {connected ? 'Connected' : 'Connecting...'}
          </span>
          <button className="ws-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="ws-body">
        <div className="ws-placeholder">
          <h2>Signed in as {user?.email || 'you'}</h2>
          <p>Role: {user?.role}</p>
          <p className="ws-note">
            Workspace shell is live and the real-time connection is
            {connected ? ' open' : ' connecting'}. Channels and the Company
            Hub are next.
          </p>
        </div>
      </main>
    </div>
  );
}
