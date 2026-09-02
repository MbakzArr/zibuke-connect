import { useState } from 'react';
import { announcementsApi, type Announcement } from '../api/resources';
import { useToast } from '../context/ToastContext';
import AnnouncementScopePicker from './AnnouncementScopePicker';

interface NewAnnouncementModalProps {
  onClose: () => void;
  onPosted: (announcement: Announcement) => void;
}

// The sidebar's "New announcement" quick action opens this, instead of the
// inline form on the hub - so posting one doesn't require navigating to the
// hub first. Same endpoint, same validation, just reachable from anywhere.
export default function NewAnnouncementModal({ onClose, onPosted }: NewAnnouncementModalProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function post() {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { announcement } = await announcementsApi.create(title.trim(), content.trim(), departmentId);
      onPosted(announcement);
      showToast('Announcement posted.', { type: 'success' });
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Could not post the announcement. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📢 New announcement</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="hub-post-form" style={{ padding: 'var(--sp-5)' }}>
          <AnnouncementScopePicker departmentId={departmentId} onChange={setDepartmentId} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What would you like to share?"
            rows={4}
          />
          {error && <p className="hub-error" role="alert">{error}</p>}
          <div className="hub-post-actions">
            <button className="hub-post-cancel" onClick={onClose}>Cancel</button>
            <button className="hub-post-send" onClick={post} disabled={busy || !title.trim() || !content.trim()}>
              {busy ? 'Posting...' : 'Post announcement'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
