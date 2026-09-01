import { type Person } from '../api/resources';
import { colorFor } from '../util/avatarColor';

// Everyone in the org, not just who's online - opened from the "Directory"
// button on the People Online card. Deliberately simple: no search, no
// filters, just the full list with a Message action each.
export default function PeopleDirectoryModal({
  people,
  onClose,
  onMessage,
}: {
  people: Person[];
  onClose: () => void;
  onMessage: (person: Person) => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Directory</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <ul className="directory-list">
          {people.map((p) => (
            <li key={p.id} className="directory-row">
              <span className={`hub-dot ${p.status === 'online' ? 'is-on' : ''}`} />
              <span className="hub-avatar" style={{ background: colorFor(p.id) }}>
                {(p.full_name || '?').charAt(0).toUpperCase()}
              </span>
              <span className="directory-info">
                <span className="directory-name">{p.full_name || p.email}</span>
                {p.job_title && <span className="directory-role">{p.job_title}{p.department_name ? ` · ${p.department_name}` : ''}</span>}
              </span>
              <button className="directory-msg" onClick={() => onMessage(p)}>Message</button>
            </li>
          ))}
          {people.length === 0 && <li className="hub-muted">No one in the directory yet.</li>}
        </ul>
      </div>
    </div>
  );
}
