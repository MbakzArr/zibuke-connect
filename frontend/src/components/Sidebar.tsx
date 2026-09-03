import { useEffect, useState } from 'react';
import { channelsApi, type Channel, type Dm } from '../api/resources';
import { useNotifications } from '../context/NotificationsContext';
import { useSocket } from '../context/SocketContext';
import { usePresenceMap } from '../context/PresenceContext';
import MiniCalendar from './MiniCalendar';

interface SidebarProps {
  activeView: string; // 'hub' or a channel id
  onSelectHub: () => void;
  onSelectChannel: (channel: Channel) => void;
  onSelectDm: (channelId: string, personName: string, userId: string) => void;
  onNewDm: () => void;
  onBrowse: () => void;
  // bumped by the parent when a new DM is opened, so the list refreshes
  dmRefreshKey: number;
  // Quick actions, kept in their own section, separated from navigation so
  // a stray tap on the channel list never triggers one by accident.
  onNewAnnouncement?: () => void;
  showAnnouncementAction?: boolean;
  // Delete (leave) a DM conversation - removes it from your list only.
  onDeleteDm?: (channelId: string, personName: string) => void;
}

// Left rail: Company Hub, the channel list, and a SEPARATE Direct Messages
// section so DMs never get lost among channels.
export default function Sidebar({
  activeView,
  onSelectHub,
  onSelectChannel,
  onSelectDm,
  onNewDm,
  onBrowse,
  dmRefreshKey,
  onNewAnnouncement,
  showAnnouncementAction,
  onDeleteDm,
}: SidebarProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Dm[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // Collapsed by default - it doesn't need to sit visible in the sidebar
  // all the time, just a click away.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { unreadDmChannelIds } = useNotifications();
  const socket = useSocket();
  const presenceMap = usePresenceMap();
  // Channels flagged unread LIVE by the socket, on top of what the last
  // fetch said. Cleared the moment the user opens that channel.
  const [liveUnread, setLiveUnread] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!socket) return;
    function onActivity(p: { channelId: string }) {
      setLiveUnread((prev) => new Set(prev).add(p.channelId));
      // Also re-sort the DM list live - previously this only flagged the
      // unread dot, so a DM you already had marked read (or one that
      // wasn't unread at all, e.g. you're not currently in it but it's
      // not flagged unread for some other reason) wouldn't visibly move
      // to the top just because new activity came in.
      loadDms();
    }
    socket.on('channel:activity', onActivity);
    return () => {
      socket.off('channel:activity', onActivity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  async function loadChannels() {
    const data = await channelsApi.list();
    setChannels(data.channels);
  }

  async function loadDms() {
    const data = await channelsApi.listDms();
    setDms(data.dms);
  }

  // Reload channels on mount, and again whenever the active view changes
  // (opening a channel, the hub, etc). This is what keeps unread badges
  // reasonably current without a full live-push system: navigating around
  // the app is exactly when it's worth re-checking what's changed.
  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  // Reload DMs whenever the parent signals a new one was opened, or when the
  // set of unread DM channels changes (a new DM from someone not yet in the
  // list should make them appear).
  useEffect(() => {
    loadDms();
  }, [dmRefreshKey, unreadDmChannelIds.size]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const { channel } = await channelsApi.create(name);
    setNewName('');
    setCreating(false);
    await loadChannels();
    onSelectChannel(channel);
  }

  return (
    <nav className="sidebar">
      <button
        className={`side-item side-hub ${activeView === 'hub' ? 'is-active' : ''}`}
        onClick={onSelectHub}
      >
        <span className="side-hub-icon">⌂</span>
        Company Hub
      </button>

      {/* Quick actions live in their own boxed-off strip, deliberately set
          apart from the navigation lists below, so they're never mistaken
          for a channel/DM row and never fat-finger-triggered by a scroll. */}
      {showAnnouncementAction && onNewAnnouncement && (
        <div className="side-quick-actions">
          <button className="side-quick-action" onClick={onNewAnnouncement}>
            <span className="side-quick-action-icon">📢</span>
            New announcement
          </button>
        </div>
      )}

      <div className="side-section">
        <div className="side-section-head">
          <span>Channels</span>
          <button className="side-add" onClick={() => setCreating((c) => !c)} aria-label="Create channel">+</button>
        </div>

        {creating && (
          <div className="side-create">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="channel-name"
              autoFocus
            />
          </div>
        )}

        <ul className="side-list">
          {channels.map((c) => {
            const hasUnread = (c.has_unread || liveUnread.has(c.id)) && activeView !== c.id;
            return (
              <li key={c.id} className="side-list-item">
                <button
                  className={`side-item ${activeView === c.id ? 'is-active' : ''} ${hasUnread ? 'has-unread' : ''}`}
                  onClick={() => {
                    setLiveUnread((prev) => {
                      if (!prev.has(c.id)) return prev;
                      const next = new Set(prev);
                      next.delete(c.id);
                      return next;
                    });
                    onSelectChannel(c);
                  }}
                >
                  <span className="side-hash">{c.is_private ? '🔒' : '#'}</span>
                  <span className="side-dm-name">{c.name}</span>
                  {hasUnread && <span className="side-unread-dot" />}
                </button>
              </li>
            );
          })}
          {channels.length === 0 && <li className="side-empty">No channels yet.</li>}
        </ul>
        <button className="side-browse" onClick={onBrowse}>Browse channels</button>
      </div>

      <div className="side-section">
        <div className="side-section-head">
          <span>Direct Messages</span>
          <button className="side-add" onClick={onNewDm} aria-label="New direct message">+</button>
        </div>

        <ul className="side-list">
          {dms.map((dm) => {
            const hasUnread = unreadDmChannelIds.has(dm.channel_id) && activeView !== dm.channel_id;
            const label = (dm.full_name || 'Direct message') + (dm.is_self ? ' (you)' : '');
            return (
              <li key={dm.channel_id} className="side-list-item side-dm-row">
                <button
                  className={`side-item side-dm-item ${activeView === dm.channel_id ? 'is-active' : ''} ${hasUnread ? 'has-unread' : ''}`}
                  onClick={() => onSelectDm(dm.channel_id, label, dm.user_id)}
                >
                  <span className={`side-dm-dot ${(presenceMap.get(dm.user_id) ?? dm.status) === 'online' ? 'is-on' : ''}`} />
                  <span className="side-dm-name">{dm.full_name || 'Unknown'}{dm.is_self ? ' (you)' : ''}</span>
                  {hasUnread && <span className="side-unread-dot" />}
                </button>
                {onDeleteDm && !dm.is_self && (
                  <button
                    className="side-dm-delete"
                    title={`Delete conversation with ${dm.full_name || 'this person'}`}
                    aria-label={`Delete conversation with ${dm.full_name || 'this person'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDm(dm.channel_id, label);
                    }}
                  >
                    🗑
                  </button>
                )}
              </li>
            );
          })}
          {dms.length === 0 && (
            <li className="side-empty">No direct messages yet. Press + to start one.</li>
          )}
        </ul>
      </div>

      <div className="side-section side-section-calendar">
        <button className="side-section-head side-section-toggle" onClick={() => setCalendarOpen((v) => !v)}>
          <span>📅 Calendar</span>
          <span className="side-toggle-chevron">{calendarOpen ? '▾' : '▸'}</span>
        </button>
        {calendarOpen && <MiniCalendar />}
      </div>
    </nav>
  );
}
