import { useEffect, useState } from 'react';
import { channelsApi, type Channel } from '../api/resources';

interface SidebarProps {
  activeView: string; // 'hub' or a channel id
  onSelectHub: () => void;
  onSelectChannel: (channel: Channel) => void;
}

// Left rail: the Company Hub link plus the list of channels the user can see.
export default function Sidebar({ activeView, onSelectHub, onSelectChannel }: SidebarProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  async function loadChannels() {
    const data = await channelsApi.list();
    setChannels(data.channels);
  }

  useEffect(() => {
    loadChannels();
  }, []);

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
          <button
            className="side-add"
            onClick={() => setCreating((c) => !c)}
            aria-label="Create channel"
          >
            +
          </button>
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
          {channels.length === 0 && (
            <li className="side-empty">No channels yet. Create one above.</li>
          )}
        </ul>
      </div>
    </nav>
  );
}
