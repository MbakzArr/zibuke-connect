import { useState } from 'react';
import { useNotifications } from '../context/NotificationsContext';

// Header bell. Shows an unread badge and opens a dropdown of recent
// notifications. Opening it marks everything read.
export default function NotificationBell() {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) markAllRead();
  }

  function label(type: string) {
    if (type === 'mention') return 'You were mentioned';
    if (type === 'announcement') return 'New announcement';
    if (type === 'dm') return 'New direct message';
    return 'Notification';
  }

  return (
    <div className="bell-wrap">
      <button className="bell-btn" onClick={toggle} aria-label="Notifications">
        <span className="bell-icon">🔔</span>
        {unreadCount > 0 && <span className="bell-badge">{unreadCount}</span>}
      </button>

      {open && (
        <>
          <div className="bell-overlay" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <div className="bell-head">Notifications</div>
            {notifications.length === 0 && (
              <div className="bell-empty">You're all caught up.</div>
            )}
            <ul className="bell-list">
              {notifications.slice(0, 15).map((n) => (
                <li key={n.id} className={`bell-item ${n.is_read ? '' : 'is-unread'}`}>
                  <span className="bell-item-label">{label(n.type)}</span>
                  <span className="bell-item-time">
                    {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
