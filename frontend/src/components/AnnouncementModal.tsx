import { useState } from 'react';
import { announcementsApi, type Announcement } from '../api/resources';
import Reactions from './Reactions';
import type { ReactionCounts } from '../api/resources';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface AnnouncementModalProps {
  announcement: Announcement;
  reactions?: ReactionCounts;
  onClose: () => void;
  // Called after a successful delete, so the caller (the Hub's own
  // announcement list) can remove it locally too, rather than needing a
  // refresh to stop seeing something that's already gone.
  onDeleted?: (id: string) => void;
}

// Full view of a single announcement. Opened by clicking an announcement in
// the hub feed, where the body may be truncated.
export default function AnnouncementModal({ announcement, reactions, onClose, onDeleted }: AnnouncementModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [deleting, setDeleting] = useState(false);

  // Same rule as channel deletion: the original poster or an admin -
  // re-checked server-side too, this is only for whether to show the
  // button at all.
  const canDelete = user?.role === 'admin' || announcement.created_by === user?.id;

  async function handleDelete() {
    if (!window.confirm('Delete this announcement for everyone? This can\'t be undone from here.')) {
      return;
    }
    setDeleting(true);
    try {
      await announcementsApi.delete(announcement.id);
      showToast('Announcement deleted.', { type: 'success' });
      onDeleted?.(announcement.id);
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not delete this announcement.', { type: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Announcement</h3>
          <div className="modal-head-actions">
            {canDelete && (
              <button className="ann-delete-btn" onClick={handleDelete} disabled={deleting} title="Delete for everyone">
                🗑️ {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
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
