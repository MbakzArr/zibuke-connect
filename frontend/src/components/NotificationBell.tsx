import { useState } from 'react';
import { useNotifications } from '../context/NotificationsContext';
import type { Notification } from '../api/resources';

interface NotificationBellProps {
  // Called when a notification is clicked and it points somewhere navigable
  // (a channel or DM). The Workspace decides how to open it.
  onNavigateToChannel: (channelId: string) => void;
  // Called to open an announcement by its id.
  onOpenAnnouncement: (announcementId: string) => void;
  // Called with the notification's own event fields (already hydrated by
  // the API, no extra fetch needed) to show event details.
  onOpenEvent: (event: { title: string; startsAt: string; venue: string | null }) => void;
}

// Time for today's notifications, "DD Mon, HH:MM" for anything older - so a
// notification from a previous day never looks like it happened minutes ago.
function formatNotifTime(iso: string): string {
  const d = new Date(iso);
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Header bell. Shows an unread badge and a dropdown of recent notifications,
// each with a real preview. Mention and DM items jump to the conversation;
// announcement and event items open their details.
export default function NotificationBell({ onNavigateToChannel, onOpenAnnouncement, onOpenEvent }: NotificationBellProps) {
  const { notifications, unreadCount, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) markAllRead();
  }

  // Build a specific, human title + preview line for each notification.
  function describe(n: Notification): { title: string; preview: string | null; clickable: boolean } {
    if (n.type === 'mention') {
      return {
        title: `${n.sender_name || 'Someone'} mentioned you`,
        preview: n.message_content || null,
        clickable: !!n.message_channel_id,
      };
    }
    if (n.type === 'dm') {
      return {
        title: `New message from ${n.sender_name || 'someone'}`,
        preview: n.message_content || null,
        clickable: !!n.message_channel_id,
      };
    }
    if (n.type === 'announcement') {
      return {
        title: 'New announcement',
        preview: n.announcement_title || null,
        // Announcements are now clickable: they open the announcement.
        clickable: true,
      };
    }
    if (n.type === 'event') {
      const timeStr = n.event_starts_at
        ? new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg' }).format(new Date(n.event_starts_at))
        : '';
      return {
        title: `You're invited: ${n.event_title || 'an event'}`,
        preview: [timeStr, n.event_venue].filter(Boolean).join(' · ') || null,
        clickable: !!n.event_title,
      };
    }
    return { title: 'Notification', preview: null, clickable: false };
  }

  function handleClick(n: Notification) {
    if (n.type === 'announcement') {
      onOpenAnnouncement(n.source_id);
      setOpen(false);
      return;
    }
    if (n.type === 'event' && n.event_title && n.event_starts_at) {
      onOpenEvent({ title: n.event_title, startsAt: n.event_starts_at, venue: n.event_venue || null });
      setOpen(false);
      return;
    }
    if (n.message_channel_id) {
      onNavigateToChannel(n.message_channel_id);
      setOpen(false);
    }
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
            {notifications.filter((n) => n.type !== 'dm').length === 0 && (
              <div className="bell-empty">You're all caught up.</div>
            )}
            <ul className="bell-list">
              {notifications.filter((n) => n.type !== 'dm').slice(0, 50).map((n) => {
                const { title, preview, clickable } = describe(n);
                return (
                  <li key={n.id}>
                    <button
                      className={`bell-item ${n.is_read ? '' : 'is-unread'} ${clickable ? 'is-clickable' : ''}`}
                      onClick={() => handleClick(n)}
                      disabled={!clickable}
                    >
                      <div className="bell-item-main">
                        <span className="bell-item-title">{title}</span>
                        {preview && <span className="bell-item-preview">{preview}</span>}
                      </div>
                      <span className="bell-item-time">
                        {formatNotifTime(n.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
