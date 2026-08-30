import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useNotifications } from '../context/NotificationsContext';
import Sidebar from '../components/Sidebar';
import ChannelView from '../components/ChannelView';
import CompanyHub from '../components/CompanyHub';
import NewDmModal from '../components/NewDmModal';
import BrowseChannels from '../components/BrowseChannels';
import SearchModal from '../components/SearchModal';
import NotificationBell from '../components/NotificationBell';
import { channelsApi, type Channel, type Person } from '../api/resources';
import './Workspace.css';

// The authenticated app. Header + sidebar are always present; the main panel
// shows the Company Hub, a channel, or a direct message.
export default function Workspace() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const { clearDmUnread } = useNotifications();
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<'hub' | 'channel'>('hub');
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [dmTitle, setDmTitle] = useState<string | undefined>(undefined);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
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
    clearDmUnread(channelId);
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

  // Open a DM with a person (from search results). Uses the DM endpoint,
  // which reuses an existing conversation.
  async function openDmWithPerson(person: Person) {
    try {
      const { channel } = await channelsApi.openDm(person.id);
      onDmOpened(channel, person.full_name || person.email);
    } catch (err) {
      console.error(err);
    }
    setShowSearch(false);
  }

  // Called when the modal successfully opens (or reuses) a DM channel.
  function onDmOpened(channel: Channel, personName: string) {
    setShowNewDm(false);
    setActiveChannel(channel);
    setDmTitle(personName);
    setView('channel');
    setDmRefreshKey((k) => k + 1); // refresh the sidebar DM list
  }

  // Called when a notification is clicked. We only have the channel id, so
  // fetch its details (or fall back to a minimal channel) and open it. For a
  // DM we resolve the other person's name for the title.
  async function navigateToChannel(channelId: string) {
    // Check the user's DMs first, so a DM notification opens with the right title.
    try {
      const { dms } = await channelsApi.listDms();
      const dm = dms.find((d) => d.channel_id === channelId);
      if (dm) {
        openDmByChannel(channelId, dm.full_name || 'Direct message');
        return;
      }
    } catch {
      // ignore, fall through to channel handling
    }
    // Otherwise treat it as a normal channel.
    try {
      const { channels } = await channelsApi.list();
      const chan = channels.find((c) => c.id === channelId);
      if (chan) {
        openChannel(chan);
        return;
      }
    } catch {
      // ignore
    }
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
          <button className="ws-search-btn" onClick={() => setShowSearch(true)}>
            🔍 Search
          </button>
          <span className={`ws-status ${connected ? 'is-online' : ''}`}>
            {connected ? 'Connected' : 'Connecting...'}
          </span>
          <NotificationBell onNavigateToChannel={navigateToChannel} />
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
          onBrowse={() => setShowBrowse(true)}
          dmRefreshKey={dmRefreshKey}
        />
        <div className="ws-panel">
          {view === 'hub' ? (
            <CompanyHub onOpenChannel={openChannel} />
          ) : activeChannel ? (
            <ChannelView channel={activeChannel} dmTitle={dmTitle} />
          ) : null}
        </div>
      </div>

      {showNewDm && (
        <NewDmModal onClose={() => setShowNewDm(false)} onOpened={onDmOpened} />
      )}

      {showBrowse && (
        <BrowseChannels
          onClose={() => setShowBrowse(false)}
          onOpened={(channel) => {
            setShowBrowse(false);
            openChannel(channel);
          }}
        />
      )}

      {showSearch && (
        <SearchModal
          onClose={() => setShowSearch(false)}
          onOpenChannel={(channelId) => {
            setShowSearch(false);
            navigateToChannel(channelId);
          }}
          onOpenPerson={openDmWithPerson}
        />
      )}
    </div>
  );
}
