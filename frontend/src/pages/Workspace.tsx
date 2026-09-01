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
import ProfileModal from '../components/ProfileModal';
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
  const [dmUserId, setDmUserId] = useState<string | undefined>(undefined);
  const [jumpToId, setJumpToId] = useState<string | undefined>(undefined);
  const [openAnnouncement, setOpenAnnouncement] = useState<Announcement | null>(null);
  const [myName, setMyName] = useState<string>('');
  // On phone-width screens, start with the sidebar hidden so the main
  // content (Company Hub / channel) is what people see first, same as any
  // mobile chat app. Desktop keeps it open by default.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [profileViewUserId, setProfileViewUserId] = useState<string | null>(null);

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

  // Push a browser history entry for the current view, so the phone's back
  // gesture/button navigates WITHIN the app (channel -> hub) before it ever
  // leaves the site. Each nav function calls this after updating state.
  function pushHistory(entry: { view: 'hub' } | { view: 'channel'; channel: Channel; dmTitle?: string }) {
    window.history.pushState(entry, '', entry.view === 'hub' ? '#hub' : `#${entry.channel.id}`);
  }

  // Restore the view when the user presses back/forward. If there's no
  // state (e.g. they've gone back past our first entry), fall back to hub.
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const state = e.state as
        | { view: 'hub' }
        | { view: 'channel'; channel: Channel; dmTitle?: string }
        | null;
      if (!state || state.view === 'hub') {
        setView('hub');
        setActiveChannel(null);
        setDmTitle(undefined);
        setDmUserId(undefined);
      } else {
        setActiveChannel(state.channel);
        setDmTitle(state.dmTitle);
        setDmUserId(undefined); // browser back doesn't carry this; re-selecting the DM restores it
        setView('channel');
      }
    }
    window.history.replaceState({ view: 'hub' }, '', '#hub');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function openChannel(channel: Channel) {
    setActiveChannel(channel);
    setDmTitle(undefined);
    setDmUserId(undefined);
    setView('channel');
    pushHistory({ view: 'channel', channel });
  }

  function openHub() {
    setView('hub');
    setActiveChannel(null);
    setDmTitle(undefined);
    setDmUserId(undefined);
    setJumpToId(undefined);
    pushHistory({ view: 'hub' });
  }

  // Open a DM by its existing channel id (from the sidebar list).
  function openDmByChannel(channelId: string, personName: string, userId?: string) {
    clearDmUnread(channelId);
    const channel: Channel = {
      id: channelId,
      name: personName,
      department_id: null,
      is_private: true,
      created_by: '',
      created_at: '',
    };
    setActiveChannel(channel);
    setDmTitle(personName);
    setDmUserId(userId);
    setView('channel');
    pushHistory({ view: 'channel', channel, dmTitle: personName });
  }

  // Open a DM with a person (from search results). Uses the DM endpoint,
  // which reuses an existing conversation.
  async function openDmWithPerson(person: Person) {
    try {
      const { channel } = await channelsApi.openDm(person.id);
      onDmOpened(channel, person.full_name || person.email, person.id);
    } catch (err) {
      console.error(err);
    }
    setShowSearch(false);
  }

  // Called when the modal successfully opens (or reuses) a DM channel.
  function onDmOpened(channel: Channel, personName: string, userId?: string) {
    setShowNewDm(false);
    setActiveChannel(channel);
    setDmTitle(personName);
    setDmUserId(userId);
    setView('channel');
    setDmRefreshKey((k) => k + 1); // refresh the sidebar DM list
    pushHistory({ view: 'channel', channel, dmTitle: personName });
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
          <button className="ws-search-field" onClick={() => setShowSearch(true)} title="Search">
            <span className="ws-search-icon">🔍</span>
            <span className="ws-search-placeholder">Search Zibuke</span>
          </button>
          <NotificationBell onNavigateToChannel={navigateToChannel} onOpenAnnouncement={openAnnouncementById} />
          <div className="ws-account-wrap">
            <button
              className="ws-account"
              onClick={() => setAccountMenuOpen((o) => !o)}
              title={`Signed in as ${myName}`}
            >
              <span className="ws-account-avatar" style={{ background: user ? colorFor(user.id) : '#4f46e5' }}>
                {(myName || 'Y').charAt(0).toUpperCase()}
              </span>
              <span className="ws-account-name">{myName}</span>
            </button>
            {accountMenuOpen && (
              <>
                <div className="ws-account-overlay" onClick={() => setAccountMenuOpen(false)} />
                <div className="ws-account-menu">
                  <div className="ws-account-menu-head">
                    <span className="ws-account-avatar" style={{ background: user ? colorFor(user.id) : '#4f46e5' }}>
                      {(myName || 'Y').charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="ws-account-menu-name">{myName}</div>
                      <div className={`ws-account-menu-status ${connected ? 'is-online' : ''}`}>
                        {connected ? 'Connected' : 'Connecting...'}
                      </div>
                    </div>
                  </div>
                  <button
                    className="ws-account-menu-item"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      if (user) setProfileViewUserId(user.id);
                    }}
                  >
                    👤 View profile
                  </button>
                  <button className="ws-account-menu-item ws-account-menu-danger" onClick={logout}>
                    ⎋ Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {profileViewUserId && (
        <ProfileModal
          userId={profileViewUserId}
          onClose={() => setProfileViewUserId(null)}
          onMessage={(userId, name) => {
            setProfileViewUserId(null);
            openDmWithPerson({
              id: userId,
              email: '',
              status: 'offline',
              full_name: name,
              job_title: null,
              department_name: null,
            });
          }}
        />
      )}

      <div className="ws-main">
        {sidebarOpen && window.innerWidth <= 720 && (
          <div className="ws-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        {sidebarOpen && (
          <div className="ws-sidebar-wrap" style={{ width: sidebarWidth }}>
            <Sidebar
              activeView={activeView}
              onSelectHub={() => {
                openHub();
                if (window.innerWidth <= 720) setSidebarOpen(false);
              }}
              onSelectChannel={(channel) => {
                setJumpToId(undefined);
                openChannel(channel);
                if (window.innerWidth <= 720) setSidebarOpen(false);
              }}
              onSelectDm={(channelId, name, userId) => {
                openDmByChannel(channelId, name, userId);
                if (window.innerWidth <= 720) setSidebarOpen(false);
              }}
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
              dmUserId={dmUserId}
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
              onBack={openHub}
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
