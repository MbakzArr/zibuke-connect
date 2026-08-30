import { useEffect, useState } from 'react';
import { channelsApi, type BrowsableChannel, type Channel } from '../api/resources';

interface BrowseChannelsProps {
  onClose: () => void;
  onOpened: (channel: Channel) => void;
}

// Lists all public channels in the org so people can find and join ones
// they're not in yet. Channels you're already in show "Open"; others show
// "Join".
export default function BrowseChannels({ onClose, onOpened }: BrowseChannelsProps) {
  const [channels, setChannels] = useState<BrowsableChannel[]>([]);
  const [query, setQuery] = useState('');

  async function load() {
    const { channels } = await channelsApi.browse();
    setChannels(channels);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = query.trim()
    ? channels.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : channels;

  async function joinAndOpen(c: BrowsableChannel) {
    if (!c.is_member) {
      await channelsApi.join(c.id);
    }
    onOpened({
      id: c.id,
      name: c.name,
      department_id: c.department_id,
      is_private: c.is_private,
      created_by: '',
      created_at: c.created_at,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Browse channels</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          className="modal-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels..."
          autoFocus
        />
        <ul className="modal-people">
          {filtered.map((c) => (
            <li key={c.id}>
              <div className="browse-row">
                <div className="browse-info">
                  <span className="browse-name"># {c.name}</span>
                  <span className="browse-count">{c.member_count} members</span>
                </div>
                <button
                  className={c.is_member ? 'browse-open' : 'browse-join'}
                  onClick={() => joinAndOpen(c)}
                >
                  {c.is_member ? 'Open' : 'Join'}
                </button>
              </div>
            </li>
          ))}
          {filtered.length === 0 && <li className="modal-empty">No channels found.</li>}
        </ul>
      </div>
    </div>
  );
}
