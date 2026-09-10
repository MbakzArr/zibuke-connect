import { useEffect, useState } from 'react';
import { channelsApi, directoryApi, type Person } from '../api/resources';
import { useToast } from '../context/ToastContext';

interface AddMemberModalProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onAdded?: () => void;
}

// Direct add, bypassing the self-request flow entirely. This is the only
// way anyone gets into a private channel after it's created, and in
// practice it's the real front door for getting a candidate into a
// channel too - they can only ever discover and request to join
// something already marked visible to them, so someone with authority
// over the channel adding them directly is how it actually happens.
export default function AddMemberModal({ channelId, channelName, onClose, onAdded }: AddMemberModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      directoryApi.search(q)
        .then((d) => {
          if (!cancelled) setResults(d.results);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  async function add(person: Person) {
    setAddingId(person.id);
    try {
      await channelsApi.addMember(channelId, person.id);
      setAdded((prev) => new Set(prev).add(person.id));
      showToast(`${person.full_name || person.email} added to #${channelName}.`, { type: 'success' });
      onAdded?.();
    } catch (err: any) {
      showToast(err?.message || 'Could not add that person.', { type: 'error' });
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add someone to #{channelName}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="add-member-body">
          <input
            className="add-member-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name..."
            autoFocus
          />
          {searching && <p className="ai-summary-loading">Searching...</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="ai-summary-empty">No one found.</p>
          )}
          <ul className="modal-people">
            {results.map((p) => (
              <li key={p.id} className="modal-person">
                <span className="modal-person-info">
                  <span className="modal-person-name">{p.full_name || p.email}</span>
                  {p.job_title && <span className="modal-person-role">{p.job_title}</span>}
                </span>
                <button
                  className="add-member-btn"
                  disabled={addingId === p.id || added.has(p.id)}
                  onClick={() => add(p)}
                >
                  {added.has(p.id) ? 'Added' : addingId === p.id ? 'Adding...' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
