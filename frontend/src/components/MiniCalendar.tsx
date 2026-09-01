import { useEffect, useState } from 'react';
import { eventsApi, type Event } from '../api/resources';

// A simple month-grid calendar for the sidebar. Shows today highlighted and
// a dot on any day that has at least one real event (from the events API,
// not mocked). Clicking a day shows that day's events inline below the
// grid - no navigation, no new page, kept deliberately light.
export default function MiniCalendar() {
  const [cursor, setCursor] = useState(() => new Date());
  const [eventDates, setEventDates] = useState<Set<string>>(new Set());
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
  }, [year, month]);

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
              {eventDates.has(dateStr(day)) && <span className="mini-cal-dot" />}
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
              {selectedEvents.length === 0 && !addingOn && <p className="hub-muted">Nothing scheduled.</p>}
              {selectedEvents.map((e) => (
                <div key={e.id} className="mini-cal-event">
                  <span className="mini-cal-event-time">
                    {new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg' }).format(new Date(e.starts_at))}
                  </span>
                  <span className="mini-cal-event-title">{e.title}</span>
                </div>
              ))}
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
