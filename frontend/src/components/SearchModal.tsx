import { useEffect, useRef, useState } from 'react';
import {
  messagesApi,
  directoryApi,
  channelsApi,
  type MessageSearchResult,
  type Person,
  type PlaceChannel,
  type PlaceDm,
} from '../api/resources';

interface SearchModalProps {
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenPerson: (person: Person) => void;
  // Jump to an existing channel or DM by its channel id (navigation).
  onOpenPlace: (channelId: string) => void;
  // Join a public channel the user isn't in yet, then open it.
  onJoinChannel: (channelId: string) => void;
}

// Global search across everything: places (channels + DMs to navigate to),
// people, and message content. Debounced.
export default function SearchModal({
  onClose,
  onOpenChannel,
  onOpenPerson,
  onOpenPlace,
  onJoinChannel,
}: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<MessageSearchResult[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [channels, setChannels] = useState<PlaceChannel[]>([]);
  const [dms, setDms] = useState<PlaceDm[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setMessages([]);
      setPeople([]);
      setChannels([]);
      setDms([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const [m, p, places] = await Promise.all([
          messagesApi.search(q),
          directoryApi.search(q),
          channelsApi.searchPlaces(q),
        ]);
        setMessages(m.results);
        setPeople(p.results);
        setChannels(places.channels);
        setDms(places.dms);
      } catch {
        // ignore transient errors while typing
      }
    }, 250);
  }, [query]);

  const hasResults =
    channels.length > 0 || dms.length > 0 || people.length > 0 || messages.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Search</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          className="modal-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search channels, people and messages..."
          autoFocus
        />
        <div className="search-results">
          {query.trim().length < 2 && (
            <p className="modal-empty">Type at least 2 characters to search.</p>
          )}

          {channels.length > 0 && (
            <div className="search-group">
              <div className="search-group-head">Channels</div>
              {channels.map((c) => (
                <button
                  key={c.id}
                  className="search-item search-item-row"
                  onClick={() => (c.is_member ? onOpenPlace(c.id) : onJoinChannel(c.id))}
                >
                  <span className="search-item-title">
                    {c.is_private ? '🔒' : '#'} {c.name}
                  </span>
                  <span className="search-item-tag">{c.is_member ? 'Open' : 'Join'}</span>
                </button>
              ))}
            </div>
          )}

          {dms.length > 0 && (
            <div className="search-group">
              <div className="search-group-head">Direct messages</div>
              {dms.map((d) => (
                <button key={d.channel_id} className="search-item" onClick={() => onOpenPlace(d.channel_id)}>
                  <span className="search-item-title">@ {d.full_name || 'Direct message'}</span>
                </button>
              ))}
            </div>
          )}

          {people.length > 0 && (
            <div className="search-group">
              <div className="search-group-head">People</div>
              {people.map((p) => (
                <button key={p.id} className="search-item" onClick={() => onOpenPerson(p)}>
                  <span className="search-item-title">{p.full_name || p.email}</span>
                  {p.job_title && <span className="search-item-sub">{p.job_title}</span>}
                </button>
              ))}
            </div>
          )}

          {messages.length > 0 && (
            <div className="search-group">
              <div className="search-group-head">Messages</div>
              {messages.map((m) => (
                <button key={m.id} className="search-item" onClick={() => onOpenChannel(m.channel_id)}>
                  <span className="search-item-title">{m.content}</span>
                  <span className="search-item-sub">
                    {m.sender_name} in {m.is_dm ? 'a direct message' : `#${m.channel_name}`}
                  </span>
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !hasResults && <p className="modal-empty">No results.</p>}
        </div>
      </div>
    </div>
  );
}
