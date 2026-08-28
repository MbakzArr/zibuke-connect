import { useState } from 'react';
import { useNotifications } from '../context/NotificationsContext';
import type { Notification } from '../api/resources';

interface NotificationBellProps {
  // Called when a notification is clicked and it points somewhere navigable
  // (a channel or DM). The Workspace decides how to open it.
  onNavigateToChannel: (channelId: string) => void;
}

// Header bell. Shows an unread badge and a dropdown of recent notifications,
// each with a real preview. Mention and DM items are clickable and jump to
// the conversation.
export default function NotificationBell({ onNavigateToChannel }: NotificationBellProps) {
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
        clickable: false,
      };
    }
    return { title: 'Notification', preview: null, clickable: false };
  }

  function handleClick(n: Notification) {
    const { clickable } = describe(n);
    if (clickable && n.message_channel_id) {
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
              {notifications.filter((n) => n.type !== 'dm').slice(0, 15).map((n) => {
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
                        {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
