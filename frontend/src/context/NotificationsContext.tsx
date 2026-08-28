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

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function markAllRead() {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider');
  return ctx;
}
