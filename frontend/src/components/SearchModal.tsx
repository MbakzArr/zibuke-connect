import { useEffect, useRef, useState } from 'react';
import { messagesApi, directoryApi, type MessageSearchResult, type Person } from '../api/resources';

interface SearchModalProps {
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenPerson: (person: Person) => void;
}

// Unified search: messages you can see, and people. Debounced so it doesn't
// fire on every keystroke.
export default function SearchModal({ onClose, onOpenChannel, onOpenPerson }: SearchModalProps) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<MessageSearchResult[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setMessages([]);
      setPeople([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const [m, p] = await Promise.all([messagesApi.search(q), directoryApi.search(q)]);
        setMessages(m.results);
        setPeople(p.results);
      } catch {
        // ignore transient errors while typing
      }
    }, 250);
  }, [query]);

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
          placeholder="Search messages and people..."
          autoFocus
        />
        <div className="search-results">
          {query.trim().length < 2 && (
            <p className="modal-empty">Type at least 2 characters to search.</p>
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

          {query.trim().length >= 2 && people.length === 0 && messages.length === 0 && (
            <p className="modal-empty">No results.</p>
          )}
        </div>
      </div>
    </div>
  );
}
