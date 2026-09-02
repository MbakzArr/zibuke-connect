// A tiny detail popup for an event invite notification. Deliberately
// minimal - title, time (always shown in SAST), and venue if set. Uses the
// fields already hydrated on the notification itself, no extra API call.
export default function EventDetailModal({
  event,
  onClose,
}: {
  event: { title: string; startsAt: string; venue: string | null };
  onClose: () => void;
}) {
  const timeStr = new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg',
  }).format(new Date(event.startsAt));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>📅 {event.title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="event-detail-body">
          <p className="event-detail-time">{timeStr} (SAST)</p>
          {event.venue && <p className="event-detail-venue">📍 {event.venue}</p>}
        </div>
      </div>
    </div>
  );
}
