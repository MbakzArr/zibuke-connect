import { useEffect, useState } from 'react';
import { channelsApi, type Channel, type Dm } from '../api/resources';
import { useNotifications } from '../context/NotificationsContext';

interface SidebarProps {
  activeView: string; // 'hub' or a channel id
  onSelectHub: () => void;
  onSelectChannel: (channel: Channel) => void;
  onSelectDm: (channelId: string, personName: string) => void;
  onNewDm: () => void;
  // bumped by the parent when a new DM is opened, so the list refreshes
  dmRefreshKey: number;
}

// Left rail: Company Hub, the channel list, and a SEPARATE Direct Messages
// section so DMs never get lost among channels.
export default function Sidebar({
  activeView,
  onSelectHub,
  onSelectChannel,
  onSelectDm,
  onNewDm,
  dmRefreshKey,
}: SidebarProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Dm[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const { unreadDmChannelIds } = useNotifications();

  async function loadChannels() {
    const data = await channelsApi.list();
    setChannels(data.channels);
  }

  async function loadDms() {
    const data = await channelsApi.listDms();
    setDms(data.dms);
  }

  useEffect(() => {
    loadChannels();
  }, []);

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
          {channels.map((c) => (
            <li key={c.id}>
              <button
                className={`side-item ${activeView === c.id ? 'is-active' : ''}`}
                onClick={() => onSelectChannel(c)}
              >
                <span className="side-hash">{c.is_private ? '🔒' : '#'}</span>
                {c.name}
              </button>
            </li>
          ))}
          {channels.length === 0 && <li className="side-empty">No channels yet.</li>}
        </ul>
      </div>

      <div className="side-section">
        <div className="side-section-head">
          <span>Direct Messages</span>
          <button className="side-add" onClick={onNewDm} aria-label="New direct message">+</button>
        </div>

        <ul className="side-list">
          {dms.map((dm) => {
            const hasUnread = unreadDmChannelIds.has(dm.channel_id) && activeView !== dm.channel_id;
            return (
              <li key={dm.channel_id}>
                <button
                  className={`side-item ${activeView === dm.channel_id ? 'is-active' : ''} ${hasUnread ? 'has-unread' : ''}`}
                  onClick={() => onSelectDm(dm.channel_id, dm.full_name || 'Direct message')}
                >
                  <span className={`side-dm-dot ${dm.status === 'online' ? 'is-on' : ''}`} />
                  <span className="side-dm-name">{dm.full_name || 'Unknown'}</span>
                  {hasUnread && <span className="side-unread-dot" />}
                </button>
              </li>
            );
          })}
          {dms.length === 0 && (
            <li className="side-empty">No direct messages yet. Press + to start one.</li>
          )}
        </ul>
      </div>
    </nav>
  );
}
