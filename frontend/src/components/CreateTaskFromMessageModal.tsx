import { useEffect, useState } from 'react';
import { aiApi, tasksApi, type ChannelMember, type Message } from '../api/resources';
import { useToast } from '../context/ToastContext';

interface CreateTaskFromMessageModalProps {
  message: Message;
  channelMembers: ChannelMember[];
  onClose: () => void;
}

// The AI only ever suggests here - title, assignee, and due date are all
// editable, and nothing gets created until the person explicitly confirms.
// assigneeName from the model is just a guessed first name pulled out of
// the message text, not a real user id, so this resolves it against the
// channel's actual members and lets the person fix it if the guess is
// wrong (or if two people share a first name).
export default function CreateTaskFromMessageModal({ message, channelMembers, onClose }: CreateTaskFromMessageModalProps) {
  const [loading, setLoading] = useState(true);
  const [hasTask, setHasTask] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    aiApi.extractTask(message.id)
      .then((d) => {
        if (cancelled) return;
        setHasTask(d.hasTask);
        setTitle(d.title || '');
        setDueDate(d.dueDate || '');
        if (d.assigneeName) {
          const guess = d.assigneeName.toLowerCase();
          const match = channelMembers.find((m) => (m.full_name || '').toLowerCase().split(' ')[0] === guess);
          if (match) setAssignedTo(match.id);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        const message = err?.message || 'Could not check this message for a task.';
        setError(message);
        showToast(message, { type: 'error' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  async function create() {
    if (!title.trim() || !assignedTo) return;
    setCreating(true);
    try {
      await tasksApi.create({ title: title.trim(), assignedTo, dueDate: dueDate || undefined });
      showToast('Task created.', { type: 'success' });
      onClose();
    } catch (err: any) {
      showToast(err?.message || 'Could not create that task.', { type: 'error' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ai-task-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📋 Create task?</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ai-task-body">
          {loading && <p className="ai-summary-loading">Reading the message...</p>}
          {!loading && error && <p className="ai-summary-error">{error}</p>}
          {!loading && !error && !hasTask && (
            <p className="ai-summary-empty">Couldn't find a clear task in this message.</p>
          )}
          {!loading && !error && hasTask && (
            <>
              <label className="ai-task-field">
                Task
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to be done" />
              </label>
              <label className="ai-task-field">
                Assign to
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Select someone...</option>
                  {channelMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                  ))}
                </select>
              </label>
              <label className="ai-task-field">
                Due date <span className="ai-task-optional">(optional)</span>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
              <div className="ai-task-actions">
                <button className="ai-task-cancel" onClick={onClose} disabled={creating}>Cancel</button>
                <button className="ai-task-create" onClick={create} disabled={creating || !title.trim() || !assignedTo}>
                  {creating ? 'Creating...' : 'Create task'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
