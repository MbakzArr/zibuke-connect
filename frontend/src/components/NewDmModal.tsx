import { useEffect, useState } from 'react';
import { directoryApi, channelsApi, type Person, type Channel } from '../api/resources';
import { useAuth } from '../context/AuthContext';

interface NewDmModalProps {
  onClose: () => void;
  onOpened: (channel: Channel, personName: string) => void;
}

// Pick a colleague to start a direct message with. Lists the directory,
// filters as you type, and calls the DM endpoint (which reuses an existing
// DM if there already is one).
export default function NewDmModal({ onClose, onOpened }: NewDmModalProps) {
  const { user } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    directoryApi.list().then((d) => setPeople(d.people));
  }, []);

  // Don't offer yourself as a DM target.
  const others = people.filter((p) => p.id !== user?.id);
  const filtered = query.trim()
    ? others.filter((p) =>
        (p.full_name || p.email).toLowerCase().includes(query.toLowerCase())
      )
    : others;

  async function start(person: Person) {
    const { channel } = await channelsApi.openDm(person.id);
    onOpened(channel, person.full_name || person.email);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New message</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          className="modal-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people..."
          autoFocus
        />
        <ul className="modal-people">
          {filtered.map((p) => (
            <li key={p.id}>
              <button className="modal-person" onClick={() => start(p)}>
                <span className="modal-avatar">
                  {(p.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="modal-person-info">
                  <span className="modal-person-name">{p.full_name || p.email}</span>
                  {p.job_title && <span className="modal-person-role">{p.job_title}</span>}
                </span>
                <span className={`modal-dot ${p.status === 'online' ? 'is-on' : ''}`} />
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="modal-empty">No people found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
