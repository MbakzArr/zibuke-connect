import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Sidebar from '../components/Sidebar';
import ChannelView from '../components/ChannelView';
import CompanyHub from '../components/CompanyHub';
import NewDmModal from '../components/NewDmModal';
import NotificationBell from '../components/NotificationBell';
import type { Channel } from '../api/resources';
import './Workspace.css';

// The authenticated app. Header + sidebar are always present; the main panel
// shows the Company Hub, a channel, or a direct message.
export default function Workspace() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'hub' | 'channel'>('hub');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [dmTitle, setDmTitle] = useState<string | undefined>(undefined);
  const [showNewDm, setShowNewDm] = useState(false);
  const [dmRefreshKey, setDmRefreshKey] = useState(0);

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
    setDmTitle(undefined);
    setView('channel');
  }

  function openHub() {
    setView('hub');
    setActiveChannel(null);
    setDmTitle(undefined);
  }

  // Open a DM by its existing channel id (from the sidebar list).
  function openDmByChannel(channelId: string, personName: string) {
    setActiveChannel({
      id: channelId,
      name: personName,
      department_id: null,
      is_private: true,
      created_by: '',
      created_at: '',
    });
    setDmTitle(personName);
    setView('channel');
  }

  // Called when the modal successfully opens (or reuses) a DM channel.
  function onDmOpened(channel: Channel, personName: string) {
    setShowNewDm(false);
    setActiveChannel(channel);
    setDmTitle(personName);
    setView('channel');
    setDmRefreshKey((k) => k + 1); // refresh the sidebar DM list
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
          <NotificationBell />
          <span className="ws-user">{user?.email}</span>
          <button className="ws-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="ws-main">
        <Sidebar
          activeView={activeView}
          onSelectHub={openHub}
          onSelectChannel={openChannel}
          onSelectDm={openDmByChannel}
          onNewDm={() => setShowNewDm(true)}
          dmRefreshKey={dmRefreshKey}
        />
        <div className="ws-panel">
          {view === 'hub' ? (
            <CompanyHub />
          ) : activeChannel ? (
            <ChannelView channel={activeChannel} dmTitle={dmTitle} />
          ) : null}
        </div>
      </div>

      {showNewDm && (
        <NewDmModal onClose={() => setShowNewDm(false)} onOpened={onDmOpened} />
      )}
    </div>
  );
}
