import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SocketShim } from './socketShim';
import { getAccessToken } from '../api/client';
import { useAuth } from './AuthContext';

// Owns the single realtime connection for the app. Opens it when a user is
// logged in, tears it down on logout. Components read it from here to
// send messages and listen for live events. SocketShim (not real
// socket.io-client) is what actually makes the connection here - see
// socketShim.ts for why, and why every OTHER file in the app that calls
// .emit()/.on()/.off() on this didn't need to change to get here.

const SocketContext = createContext<SocketShim | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<SocketShim | null>(null);
  // Temporary diagnostic: tracks whether this effect is re-running because
  // `user` is genuinely a new object each time (a bug elsewhere, in
  // AuthContext) versus this whole component unmounting and remounting
  // (a different bug, likely higher up the tree) - the socketShim.ts logs
  // showed disconnect() firing repeatedly, but not WHY the effect that
  // calls it keeps re-running in the first place.
  const runCount = useRef(0);
  const prevUserRef = useRef(user);

  useEffect(() => {
    runCount.current += 1;
    const sameUserObject = prevUserRef.current === user;
    console.log(`[SocketProvider] effect run #${runCount.current} - user=${user ? JSON.stringify(user) : 'null'} sameObjectAsLastRun=${sameUserObject}`);
    prevUserRef.current = user;

    if (!user) {
      setSocket(null);
      return;
    }

    const token = getAccessToken();
    if (!token) {
      setSocket(null);
      return;
    }
    const s = new SocketShim(token);
    setSocket(s);

    // Clean up the connection when the user logs out or the app unmounts.
    return () => {
      console.log(`[SocketProvider] effect #${runCount.current} cleanup running (either user changed again, or this component is unmounting)`);
      s.disconnect();
    };
  }, [user]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
