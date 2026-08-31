import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { useNotifications } from '../context/NotificationsContext';
import { colorFor } from '../util/avatarColor';
import Sidebar from '../components/Sidebar';
import ChannelView from '../components/ChannelView';
import CompanyHub from '../components/CompanyHub';
import NewDmModal from '../components/NewDmModal';
import BrowseChannels from '../components/BrowseChannels';
import SearchModal from '../components/SearchModal';
import NotificationBell from '../components/NotificationBell';
import AnnouncementModal from '../components/AnnouncementModal';
import { channelsApi, announcementsApi, directoryApi, type Channel, type Person, type Announcement } from '../api/resources';
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
  const [jumpToId, setJumpToId] = useState<string | undefined>(undefined);
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);

  // Drag-to-resize the sidebar. Mousedown on the handle starts a drag that
  // updates the width live, clamped so it stays usable.
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    function onMove(ev: MouseEvent) {
      const next = startWidth + (ev.clientX - startX);
      setSidebarWidth(Math.min(420, Math.max(180, next)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    }
    // Prevent text selection while dragging.
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Fetch the logged-in user's display name once, for the account chip, so
  // it's always clear whose account is active.
  useEffect(() => {
    if (!user) return;
    directoryApi.profile(user.id).then((d) => {
      setMyName(d.profile.full_name || user.email || 'You');
    }).catch(() => setMyName(user.email || 'You'));
  }, [user]);
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
    setJumpToId(undefined);
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
    // Fallback: resolve from the browsable (public) channel list, so a channel
    // just joined via search opens even if the member list is momentarily stale.
    try {
      const { channels } = await channelsApi.browse();
      const c = channels.find((ch) => ch.id === channelId);
      if (c) {
        openChannel({
          id: c.id,
          name: c.name,
          department_id: c.department_id,
          is_private: c.is_private,
          created_by: '',
          created_at: c.created_at,
        });
      }
    } catch {
      // ignore
    }
  }

  // Open an announcement (from a notification) by fetching it and showing the modal.
  async function openAnnouncementById(announcementId: string) {
    try {
      const { announcement } = await announcementsApi.get(announcementId);
      setOpenAnnouncement(announcement);
    } catch (err) {
      console.error(err);
    }
  }

  const activeView = view === 'hub' ? 'hub' : activeChannel?.id || '';

  return (
    <div className="ws-shell">
      <header className="ws-header">
        <div className="ws-brand">
          <button
            className="ws-sidebar-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>
          <span className="ws-mark">Z</span>
          <span className="ws-name">Zibuke Connect</span>
        </div>
        <div className="ws-header-right">
          <button className="ws-search-field" onClick={() => setShowSearch(true)}>
            <span className="ws-search-icon">🔍</span>
            <span className="ws-search-placeholder">Search Zibuke</span>
          </button>
          <span className={`ws-status ${connected ? 'is-online' : ''}`}>
            {connected ? 'Connected' : 'Connecting...'}
          </span>
          <NotificationBell onNavigateToChannel={navigateToChannel} onOpenAnnouncement={openAnnouncementById} />
          <div className="ws-account" title={`Signed in as ${myName}`}>
            <span className="ws-account-avatar" style={{ background: user ? colorFor(user.id) : '#4f46e5' }}>
              {(myName || 'Y').charAt(0).toUpperCase()}
            </span>
            <span className="ws-account-name">{myName}</span>
          </div>
          <button className="ws-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <div className="ws-main">
        {sidebarOpen && (
          <div className="ws-sidebar-wrap" style={{ width: sidebarWidth }}>
            <Sidebar
              activeView={activeView}
              onSelectHub={openHub}
              onSelectChannel={(channel) => {
                setJumpToId(undefined);
                openChannel(channel);
              }}
              onSelectDm={openDmByChannel}
              onNewDm={() => setShowNewDm(true)}
              onBrowse={() => setShowBrowse(true)}
              dmRefreshKey={dmRefreshKey}
            />
            <div className="ws-resize-handle" onMouseDown={startResize} title="Drag to resize" />
          </div>
        )}
        <div className="ws-panel">
          {view === 'hub' ? (
            <CompanyHub onOpenChannel={openChannel} onMessagePerson={openDmWithPerson} />
          ) : activeChannel ? (
            <ChannelView
              channel={activeChannel}
              dmTitle={dmTitle}
              jumpToId={jumpToId}
              onOpenDm={(userId, name) =>
                openDmWithPerson({
                  id: userId,
                  email: '',
                  status: 'offline',
                  full_name: name,
                  job_title: null,
                  department_name: null,
                })
              }
            />
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
          onOpenChannel={(channelId, messageId) => {
            setShowSearch(false);
            setJumpToId(messageId);
            navigateToChannel(channelId);
          }}
          onOpenPerson={openDmWithPerson}
          onOpenPlace={(channelId) => {
            setShowSearch(false);
            setJumpToId(undefined);
            navigateToChannel(channelId);
          }}
          onJoinChannel={async (channelId) => {
            setShowSearch(false);
            try {
              await channelsApi.join(channelId);
            } catch {
              // may already be a member; ignore
            }
            navigateToChannel(channelId);
          }}
        />
      )}
      {openAnnouncement && (
        <AnnouncementModal
          announcement={openAnnouncement}
          onClose={() => setOpenAnnouncement(null)}
        />
      )}
    </div>
  );
}
