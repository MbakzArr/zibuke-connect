import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Sidebar from '../components/Sidebar';
import ChannelView from '../components/ChannelView';
import CompanyHub from '../components/CompanyHub';
import type { Channel } from '../api/resources';
import './Workspace.css';

// The authenticated app. Header + sidebar are always present; the main panel
// shows either the Company Hub or a selected channel.
export default function Workspace() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'hub' | 'channel'>('hub');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);

  useEffect(() => {
    if (!socket) return;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    if (socket.connected) setConnected(true);
    return () => {
      socket.off('connect');
      socket.off('disconnect');
    };
  }, [socket]);

  function openChannel(channel: Channel) {
    setActiveChannel(channel);
    setView('channel');
  }

  function openHub() {
    setView('hub');
    setActiveChannel(null);
  }

  const activeView = view === 'hub' ? 'hub' : activeChannel?.id || '';

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
          <span className="ws-user">{user?.email}</span>
          <button className="ws-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="ws-main">
        <Sidebar
          activeView={activeView}
          onSelectHub={openHub}
          onSelectChannel={openChannel}
        />
        <div className="ws-panel">
          {view === 'hub' ? (
            <CompanyHub />
          ) : activeChannel ? (
            <ChannelView channel={activeChannel} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
