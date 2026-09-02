import { useState } from 'react';
import { type Person } from '../api/resources';
import { colorFor } from '../util/avatarColor';
import { statusColor, statusLabel } from '../util/status';

// Everyone in the org, not just who's online - opened from the "Directory"
// button on the People Online card. Filters client-side as you type (the
// full list is already loaded by the hub, so there's no need for a second
// round trip). Job title and availability are shown as their own labelled
// lines rather than folded into one string, so they're easy to scan.
// Clicking a row opens that person's profile - same as clicking a name
// under a channel's Members list; the Message button is a separate,
// explicit action so it doesn't fire by accident when you meant to view
// the profile.
export default function PeopleDirectoryModal({
  people,
  onClose,
  onMessage,
  onViewProfile,
}: {
  people: Person[];
  onClose: () => void;
  onMessage: (person: Person) => void;
  onViewProfile: (userId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? people.filter((p) =>
        (p.full_name || p.email).toLowerCase().includes(q) ||
        (p.job_title || '').toLowerCase().includes(q) ||
        (p.department_name || '').toLowerCase().includes(q)
      )
    : people;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Directory</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <input
          className="modal-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, job title or department..."
          autoFocus
        />
        <ul className="directory-list">
          {filtered.map((p) => (
            <li key={p.id} className="directory-row">
              <button className="directory-row-btn" onClick={() => onViewProfile(p.id)}>
                <span className="hub-dot" style={{ background: statusColor(p.status, p.availability) }} title={statusLabel(p.status, p.availability)} />
                <span className="hub-avatar" style={{ background: colorFor(p.id) }}>
                  {(p.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="directory-info">
                  <span className="directory-name">
                    {p.full_name || p.email}
                    {p.heads_department_name && (
                      <span className="directory-head-badge" title={`Head of ${p.heads_department_name}`}>🏢 Head</span>
                    )}
                  </span>
                  <span className="directory-line">
                    <span className="directory-jobtitle">{p.job_title || 'Job title not set'}</span>
                    {p.department_name && <span className="directory-dept">{p.department_name}</span>}
                  </span>
                  <span className={`directory-availability directory-availability--${p.status === 'online' ? (p.availability || 'available') : 'offline'}`}>
                    {statusLabel(p.status, p.availability)}
                  </span>
                </span>
              </button>
              <button className="directory-msg" onClick={() => onMessage(p)}>Message</button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="hub-muted">
              {q ? `No one matches "${query}".` : 'No one in the directory yet.'}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
