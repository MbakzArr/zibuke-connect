import { useEffect, useState } from 'react';
import { eventsApi, tasksApi, type Event, type Task } from '../api/resources';
import { useAuth } from '../context/AuthContext';
import EventListItem from './EventListItem';

// A simple month-grid calendar for the sidebar. Shows today highlighted, an
// amber dot on any day with a real event, and a small blue square on any
// day one of your own tasks is due (from the events/tasks APIs, not
// mocked). Clicking a day shows both inline below the grid - no
// navigation, no new page, kept deliberately light.
export default function MiniCalendar() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => new Date());
  const [eventDates, setEventDates] = useState<Set<string>>(new Set());
  const [taskDates, setTaskDates] = useState<Set<string>>(new Set());
  // All of my tasks, fetched once - small enough for a demo that filtering
  // client-side by due date beats a dedicated per-day endpoint.
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Event[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [addingOn, setAddingOn] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-indexed

  useEffect(() => {
    eventsApi.monthDates(year, month + 1).then((d) => setEventDates(new Set(d.dates)));
    tasksApi.monthDates(year, month + 1).then((d) => setTaskDates(new Set(d.dates)));
  }, [year, month]);

  useEffect(() => {
    tasksApi.mine().then((d) => setMyTasks(d.tasks));
  }, []);

  const first = new Date(year, month, 1);
  const startWeekday = first.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const selectedTasks = selectedDate ? myTasks.filter((t) => t.due_date === selectedDate) : [];

  async function pickDay(day: number) {
    const ds = dateStr(day);
    if (selectedDate === ds) {
      setSelectedDate(null);
      setAddingOn(false);
      return;
    }
    setSelectedDate(ds);
    setAddingOn(false);
    setLoadingDay(true);
    try {
      const d = await eventsApi.forDate(ds);
      setSelectedEvents(d.events);
    } finally {
      setLoadingDay(false);
    }
  }

  async function saveNewEvent() {
    if (!selectedDate || !newTitle.trim() || !newTime) return;
    setSavingNew(true);
    try {
      const startsAt = `${selectedDate}T${newTime}:00+02:00`;
      const { event } = await eventsApi.create(newTitle.trim(), startsAt);
      setSelectedEvents((prev) => [...prev, event].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
      setEventDates((prev) => new Set(prev).add(selectedDate));
      setNewTitle('');
      setNewTime('');
      setAddingOn(false);
    } finally {
      setSavingNew(false);
    }
  }

  async function toggleTaskDone(task: Task) {
    const nextStatus = task.status === 'done' ? 'open' : 'done';
    const { task: updated } = await tasksApi.setStatus(task.id, nextStatus);
    setMyTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    if (nextStatus === 'done' && selectedDate) {
      // If this was the last open task due that day, drop the square dot.
      const stillOpen = myTasks.some((t) => t.id !== task.id && t.due_date === selectedDate && t.status === 'open');
      if (!stillOpen) setTaskDates((prev) => { const next = new Set(prev); next.delete(selectedDate); return next; });
    }
  }

  const monthLabel = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(cursor);

  return (
    <div className="mini-cal">
      <div className="mini-cal-head">
        <button className="mini-cal-nav" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Previous month">‹</button>
        <span className="mini-cal-title">{monthLabel}</span>
        <button className="mini-cal-nav" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Next month">›</button>
      </div>
      <div className="mini-cal-weekdays">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mini-cal-grid">
        {cells.map((day, i) =>
          day === null ? (
            <span key={i} className="mini-cal-cell mini-cal-empty" />
          ) : (
            <button
              key={i}
              className={`mini-cal-cell ${dateStr(day) === todayStr ? 'is-today' : ''} ${selectedDate === dateStr(day) ? 'is-selected' : ''}`}
              onClick={() => pickDay(day)}
            >
              {day}
              <span className="mini-cal-dot-row">
                {eventDates.has(dateStr(day)) && <span className="mini-cal-dot" title="Event" />}
                {taskDates.has(dateStr(day)) && <span className="mini-cal-task-dot" title="Task due" />}
              </span>
            </button>
          )
        )}
      </div>
      {selectedDate && (
        <div className="mini-cal-day-events">
          {loadingDay ? (
            <p className="hub-muted">Loading…</p>
          ) : (
            <>
              {selectedEvents.length === 0 && selectedTasks.length === 0 && !addingOn && (
                <p className="hub-muted">Nothing scheduled.</p>
              )}
              {selectedTasks.length > 0 && (
                <ul className="mini-cal-task-list">
                  {selectedTasks.map((t) => (
                    <li key={t.id} className={`mini-cal-task-row ${t.status === 'done' ? 'is-done' : ''}`}>
                      <label>
                        <input type="checkbox" checked={t.status === 'done'} onChange={() => toggleTaskDone(t)} />
                        {t.title}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="mini-cal-event-list">
                {selectedEvents.map((e) => (
                  <EventListItem
                    key={e.id}
                    event={e}
                    isOwner={user?.id === e.created_by}
                    compact
                    onUpdated={(updated) =>
                      setSelectedEvents((prev) => prev.map((ev) => (ev.id === updated.id ? updated : ev)))
                    }
                    onDeleted={(id) => setSelectedEvents((prev) => prev.filter((ev) => ev.id !== id))}
                  />
                ))}
              </ul>
              {addingOn ? (
                <div className="mini-cal-add-form">
                  <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Event title" />
                  <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                  <div className="mini-cal-add-actions">
                    <button className="hub-post-cancel" onClick={() => setAddingOn(false)}>Cancel</button>
                    <button className="hub-post-send" onClick={saveNewEvent} disabled={savingNew}>
                      {savingNew ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="mini-cal-add-btn" onClick={() => setAddingOn(true)}>+ Add event</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
