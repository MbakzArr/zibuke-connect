import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { notificationsApi, type Notification } from '../api/resources';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';

// Holds the user's notifications and keeps them live. Loads the existing
// list on login, then listens on the socket for notification:new events the
// backend pushes (from mentions, announcements, and DMs). Exposes the unread
// count for the header bell.

interface NotificationsValue {
  notifications: Notification[];
  unreadCount: number;
  markAllRead: () => Promise<void>;
  // DMs are surfaced in the sidebar, not the bell. These helpers expose the
  // set of DM channels with unread messages, and clear one when opened.
  unreadDmChannelIds: Set<string>;
  clearDmUnread: (channelId: string) => void;
}

const NotificationsContext = createContext<NotificationsValue | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const socket = useSocket();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Load existing notifications once we have a user.
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    notificationsApi.list().then((d) => setNotifications(d.notifications));
  }, [user]);

  // Listen for live notifications pushed over the socket.
  useEffect(() => {
    if (!socket) return;
    function onNew(n: Notification) {
      setNotifications((prev) => [n, ...prev]);
    }
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [socket]);

  // The bell shows mentions + announcements only. DMs are surfaced in the
  // sidebar instead, so they don't count toward the bell badge.
  const unreadCount = notifications.filter((n) => !n.is_read && n.type !== 'dm').length;

  // DM channels that have at least one unread dm notification, so the sidebar
  // can badge the person's name.
  const unreadDmChannelIds = new Set(
    notifications
      .filter((n) => n.type === 'dm' && !n.is_read && n.message_channel_id)
      .map((n) => n.message_channel_id as string)
  );

  // Mark this channel's DM notifications read locally when the user opens it.
  // (They're also marked read server-side via markAllRead when the bell is
  // opened, but opening the DM itself should clear its badge immediately.)
  function clearDmUnread(channelId: string) {
    setNotifications((prev) =>
      prev.map((n) =>
        n.type === 'dm' && n.message_channel_id === channelId ? { ...n, is_read: true } : n
      )
    );
  }

  async function markAllRead() {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, markAllRead, unreadDmChannelIds, clearDmUnread }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}
