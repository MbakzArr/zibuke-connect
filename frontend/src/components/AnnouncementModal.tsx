import type { Announcement } from '../api/resources';
import Reactions from './Reactions';
import type { ReactionCounts } from '../api/resources';

interface AnnouncementModalProps {
  announcement: Announcement;
  reactions?: ReactionCounts;
  onClose: () => void;
}

// Full view of a single announcement. Opened by clicking an announcement in
// the hub feed, where the body may be truncated.
export default function AnnouncementModal({ announcement, reactions, onClose }: AnnouncementModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Announcement</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ann-modal-body">
          <div className="ann-modal-title">{announcement.title}</div>
          {announcement.department_name && (
            <div className="ann-modal-dept">{announcement.department_name}</div>
          )}
          <div className="ann-modal-content">{announcement.content}</div>
          <div className="ann-modal-meta">
            {announcement.author_name} · {new Date(announcement.created_at).toLocaleString()}
          </div>
          <Reactions targetType="announcement" targetId={announcement.id} initial={reactions} />
        </div>
      </div>
    </div>
  );
}
