import { useEffect, useState } from 'react';
import { channelsApi, type BrowsableChannel, type Channel } from '../api/resources';
import { useToast } from '../context/ToastContext';

interface BrowseChannelsProps {
  onClose: () => void;
  onOpened: (channel: Channel) => void;
}

// Lists all public channels in the org so people can find them. Channels
// you're already in show "Open"; others show "Join" - which now sends a
// request to the channel's creator instead of joining immediately (see
// requestToJoin on the backend), so a channel you just requested shows
// "Requested" instead of opening straight away.
export default function BrowseChannels({ onClose, onOpened }: BrowseChannelsProps) {
  const [channels, setChannels] = useState<BrowsableChannel[]>([]);
  const [query, setQuery] = useState('');
  const [requesting, setRequesting] = useState<string | null>(null);
  const { showToast } = useToast();

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

  function openChannel(c: BrowsableChannel) {
    onOpened({
      id: c.id,
      name: c.name,
      department_id: c.department_id,
      department_name: c.department_name,
      is_private: c.is_private,
      created_by: '',
      created_at: c.created_at,
    });
  }

  async function requestJoin(c: BrowsableChannel) {
    setRequesting(c.id);
    try {
      const result = await channelsApi.join(c.id);
      if (result.status === 'already_member') {
        openChannel(c);
        return;
      }
      // 'requested' or 'already_requested' both land here - either way,
      // there's now a pending request, so reflect that rather than
      // opening a channel they're not actually in yet.
      setChannels((prev) => prev.map((x) => (x.id === c.id ? { ...x, has_pending_request: true } : x)));
      showToast(
        result.status === 'already_requested' ? "You've already requested to join - waiting on approval." : 'Request sent - the channel owner will need to approve it.',
        { type: 'info' }
      );
    } catch (err: any) {
      showToast(err?.message || 'Could not send that request.', { type: 'error' });
    } finally {
      setRequesting(null);
    }
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
                  <span className="browse-name">
                    # {c.name}
                    {c.department_name && <span className="browse-dept"> · {c.department_name}</span>}
                  </span>
                  <span className="browse-count">{c.member_count} members</span>
                </div>
                {c.is_member ? (
                  <button className="browse-open" onClick={() => openChannel(c)}>Open</button>
                ) : c.has_pending_request ? (
                  <button className="browse-pending" disabled>Requested</button>
                ) : (
                  <button className="browse-join" onClick={() => requestJoin(c)} disabled={requesting === c.id}>
                    {requesting === c.id ? 'Requesting...' : 'Join'}
                  </button>
                )}
              </div>
            </li>
          ))}
          {filtered.length === 0 && <li className="modal-empty">No channels found.</li>}
        </ul>
      </div>
    </div>
  );
}
