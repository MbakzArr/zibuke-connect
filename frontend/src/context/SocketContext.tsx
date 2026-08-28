import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, BASE_URL } from '../api/client';
import { useAuth } from './AuthContext';

// Owns the single Socket.io connection for the app. Opens it when a user is
// logged in, tears it down on logout. Components read the socket from here
// to send messages and listen for live events.

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      return;
    }

    const s = io(BASE_URL, { auth: { token: getAccessToken() } });
    setSocket(s);

    // Clean up the connection when the user logs out or the app unmounts.
    return () => {
      s.disconnect();
    };
  }, [user]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
