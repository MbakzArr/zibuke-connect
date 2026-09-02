import { useState } from 'react';
import { eventsApi, type Event } from '../api/resources';

function formatSAST(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

// "17 Jul" - shown alongside the time so an event never reads as
// date-less, whether it's today's or one picked from another day on the
// sidebar calendar.
function formatSASTDate(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

// One event, used in both "Your Day" (Company Hub) and the sidebar
// calendar's day panel - same component, same buttons, everywhere an event
// appears. Clicking the row expands full details (venue + attendees) in
// place. If you created it, edit/delete controls appear too. attendee_names
// is defensively defaulted to [] - a past bug (now fixed server-side)
// briefly returned events without it, which crashed the page; this guard
// means a similar shape mismatch degrades gracefully instead of crashing.
export default function EventListItem({
  event,
  isOwner,
  onUpdated,
  onDeleted,
  compact,
}: {
  event: Event;
  isOwner: boolean;
  onUpdated: (e: Event) => void;
  onDeleted: (id: string) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(event.title);
  const [time, setTime] = useState(formatSAST(event.starts_at));
  const [venue, setVenue] = useState(event.venue || '');
  const [busy, setBusy] = useState(false);
  const attendees = event.attendee_names || [];

  async function save() {
    setBusy(true);
    try {
      const dateStr = event.starts_at.slice(0, 10);
      const startsAt = `${dateStr}T${time}:00+02:00`;
      const { event: updated } = await eventsApi.update(event.id, { title: title.trim(), startsAt, venue: venue.trim() });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    await eventsApi.remove(event.id);
    onDeleted(event.id);
  }

  const itemClass = compact ? 'evt-item evt-item-compact' : 'evt-item';

  if (editing) {
    return (
      <li className={`${itemClass} evt-item-editing`}>
        <div className="hub-event-form">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Venue" className="hub-event-venue" />
          <button className="hub-post-cancel" onClick={() => setEditing(false)}>Cancel</button>
          <button className="hub-post-send" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </li>
    );
  }

  return (
    <li className={itemClass}>
      <button className="evt-item-main" onClick={() => setExpanded((v) => !v)}>
        <span className="evt-time-wrap">
          <span className="evt-date">{formatSASTDate(event.starts_at)}</span>
          <span className="evt-time">{formatSAST(event.starts_at)}</span>
        </span>
        <span className="evt-body">
          <span className="evt-title">{event.title}</span>
          {!expanded && (event.venue || attendees.length > 0) && (
            <span className="evt-meta-compact">
              {event.venue && `📍 ${event.venue}`}
              {event.venue && attendees.length > 0 ? ' · ' : ''}
              {attendees.length > 0 && `👥 ${attendees.length}`}
            </span>
          )}
        </span>
      </button>

      {isOwner && (
        <div className="evt-actions">
          <button className="evt-action" onClick={() => setEditing(true)} title="Edit">✏️</button>
          <button className="evt-action" onClick={remove} title="Delete">🗑️</button>
        </div>
      )}

      {expanded && (
        <div className="evt-expanded">
          {event.venue && <div className="evt-expanded-line">📍 {event.venue}</div>}
          {attendees.length > 0 && <div className="evt-expanded-line">👥 {attendees.join(', ')}</div>}
          {event.author_name && <div className="evt-expanded-line evt-expanded-author">Organised by {event.author_name}</div>}
          {!event.venue && attendees.length === 0 && <div className="evt-expanded-line hub-muted">No further details.</div>}
        </div>
      )}
    </li>
  );
}
