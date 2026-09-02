import { useEffect, useState } from 'react';
import { tasksApi, type Task, type Person } from '../api/resources';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

// "YYYY-MM-DD" for right now, in SAST specifically - matches how the rest
// of the hub decides what counts as "today".
function todaySAST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

// Defensive on top of the backend fix (tasks.service.ts now always sends
// a plain "YYYY-MM-DD" string): if a due date ever arrives malformed for
// any reason, fall back to showing it as-is rather than throwing and
// taking the whole hub down with it. A RangeError from Intl/Date inside
// a render is exactly what crashed this before - one bad task shouldn't
// be able to do that again.
function formatDue(dateStr: string): { label: string; overdue: boolean; dueToday: boolean } {
  const today = todaySAST();
  const overdue = dateStr < today;
  const dueToday = dateStr === today;
  try {
    const label = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' }).format(
      new Date(`${dateStr}T00:00:00+02:00`)
    );
    return { label, overdue, dueToday };
  } catch {
    return { label: dateStr, overdue, dueToday };
  }
}

// Simple assignable to-do list: title, optional description, optional due
// date, assign to anyone (including yourself - a personal reminder is a
// valid use). Two tabs - what's on YOUR plate, and what you've handed to
// others, so assigning isn't a one-way fire-and-forget. Due dates also
// show as dots on the sidebar calendar (see MiniCalendar.tsx). The
// "reminder" is the due-soon toast CompanyHub fires on load, not a
// background job - there's no scheduler in this app, so it's computed
// fresh every time the hub opens instead.
export default function TasksWidget({ people }: { people: Person[] }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<'mine' | 'assigned'>('mine');
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssign, setShowAssign] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [mine, assigned] = await Promise.all([tasksApi.mine(), tasksApi.assignedByMe()]);
      setMyTasks(mine.tasks);
      setAssignedTasks(assigned.tasks);
    } catch {
      showToast('Could not load tasks.', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(t: Task) {
    setBusyId(t.id);
    try {
      const nextStatus = t.status === 'done' ? 'open' : 'done';
      const { task } = await tasksApi.setStatus(t.id, nextStatus);
      setMyTasks((prev) => prev.map((x) => (x.id === t.id ? task : x)));
      setAssignedTasks((prev) => prev.map((x) => (x.id === t.id ? task : x)));
    } catch (err: any) {
      showToast(err?.message || 'Could not update that task.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: Task) {
    if (!window.confirm(`Delete "${t.title}"?`)) return;
    setBusyId(t.id);
    try {
      await tasksApi.remove(t.id);
      setMyTasks((prev) => prev.filter((x) => x.id !== t.id));
      setAssignedTasks((prev) => prev.filter((x) => x.id !== t.id));
      showToast('Task deleted.', { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not delete that task.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const list = tab === 'mine' ? myTasks : assignedTasks;
  const openCount = myTasks.filter((t) => t.status === 'open').length;

  return (
    <div className="hub-card hub-card--rose">
      <div className="hub-card-head">
        <h3>✅ Tasks {openCount > 0 && <span className="hub-task-count">{openCount}</span>}</h3>
        <button className="hub-post-btn" onClick={() => setShowAssign((v) => !v)}>
          {showAssign ? 'Cancel' : '+ Assign'}
        </button>
      </div>

      <div className="hub-task-tabs">
        <button className={`hub-task-tab ${tab === 'mine' ? 'is-active' : ''}`} onClick={() => setTab('mine')}>
          My tasks
        </button>
        <button className={`hub-task-tab ${tab === 'assigned' ? 'is-active' : ''}`} onClick={() => setTab('assigned')}>
          Assigned by me
        </button>
      </div>

      {showAssign && (
        <AssignTaskForm
          people={people}
          selfId={user?.id}
          onAssigned={(t) => {
            setShowAssign(false);
            if (t.assigned_to === user?.id) setMyTasks((prev) => [t, ...prev]);
            if (t.assigned_by === user?.id && t.assigned_to !== user?.id) setAssignedTasks((prev) => [t, ...prev]);
          }}
        />
      )}

      {loading ? (
        <p className="hub-muted">Loading...</p>
      ) : list.length === 0 ? (
        <p className="hub-muted">{tab === 'mine' ? 'No tasks on your plate.' : "You haven't assigned anyone a task yet."}</p>
      ) : (
        <ul className="hub-task-list">
          {list.map((t) => {
            const due = t.due_date ? formatDue(t.due_date) : null;
            return (
              <li key={t.id} className={`hub-task-row ${t.status === 'done' ? 'is-done' : ''}`}>
                <label className="hub-task-check">
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    disabled={busyId === t.id}
                    onChange={() => toggleStatus(t)}
                  />
                </label>
                <span className="hub-task-info">
                  <span className="hub-task-title">{t.title}</span>
                  <span className="hub-task-meta">
                    {tab === 'mine' && t.assigner_name && t.assigned_by !== t.assigned_to && (
                      <span>from {t.assigner_name}</span>
                    )}
                    {tab === 'assigned' && t.assignee_name && <span>to {t.assignee_name}</span>}
                    {due && (
                      <span className={`hub-task-due ${due.overdue && t.status === 'open' ? 'is-overdue' : due.dueToday && t.status === 'open' ? 'is-today' : ''}`}>
                        {due.overdue && t.status === 'open' ? 'Overdue · ' : ''}{due.label}
                      </span>
                    )}
                  </span>
                </span>
                {tab === 'assigned' && (
                  <button className="hub-task-delete" disabled={busyId === t.id} onClick={() => remove(t)} title="Delete task">
                    🗑
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AssignTaskForm({
  people,
  selfId,
  onAssigned,
}: {
  people: Person[];
  selfId?: string;
  onAssigned: (t: Task) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState(selfId || '');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function submit() {
    if (!title.trim() || !assignedTo) {
      setError('Title and assignee are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { task } = await tasksApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        assignedTo,
        dueDate: dueDate || undefined,
      });
      showToast(`Task assigned${task.assignee_name ? ` to ${task.assignee_name}` : ''}.`, { type: 'success' });
      onAssigned(task);
    } catch (err: any) {
      setError(err?.message || 'Could not assign that task.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hub-task-assign-form">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)"
        rows={2}
      />
      <div className="hub-task-assign-row">
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          {selfId && <option value={selfId}>Myself</option>}
          {people.filter((p) => p.id !== selfId).map((p) => (
            <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
          ))}
        </select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </div>
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-post-actions">
        <button className="hub-post-send" onClick={submit} disabled={busy}>
          {busy ? 'Assigning...' : 'Assign task'}
        </button>
      </div>
    </div>
  );
}
