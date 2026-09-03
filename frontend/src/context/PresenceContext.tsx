import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSocket } from './SocketContext';

// One 'presence:update' listener for the whole app, instead of every
// component that shows a person's online/offline status needing its own.
// The backend has always broadcast this event (see RealtimeRoom.ts /
// socketGateway.ts) - nothing was ever listening for it on the frontend,
// so every status dot only ever reflected whatever it was at the moment
// that component's own REST fetch ran, frozen until the next reload.
//
// Usage: components keep fetching their own person/people data via REST
// exactly as before (this doesn't replace that - it's still the source
// of a NEWLY loaded status) - they just also call
// useLivePresence(person.id, person.status) wherever they currently
// render status, which returns the freshest known value: the live one if
// this map has heard about that person since page load, otherwise the
// REST-fetched fallback passed in.

const PresenceContext = createContext<Map<string, string>>(new Map());

export function PresenceProvider({ children }: { children: ReactNode }) {
  const socket = useSocket();
  const [presence, setPresence] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!socket) return;
    function onUpdate(p: { userId: string; status: string }) {
      setPresence((prev) => {
        const next = new Map(prev);
        next.set(p.userId, p.status);
        return next;
      });
    }
    socket.on('presence:update', onUpdate);
    return () => {
      socket.off('presence:update', onUpdate);
    };
  }, [socket]);

  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>;
}

// Returns the live status for a user if one has arrived since page load,
// otherwise the fallback (whatever REST returned when the component
// fetched its own data).
export function useLivePresence(userId: string | undefined, fallback: string | undefined): string | undefined {
  const presence = useContext(PresenceContext);
  if (!userId) return fallback;
  return presence.get(userId) ?? fallback;
}

// The raw live map, for places that need to react to presence across a
// whole LIST of people at once (e.g. filtering who counts as "online"
// right now) rather than one person at a time - useLivePresence can't be
// called inside a loop (Rules of Hooks), so this is the escape hatch for
// that case; combine it with each person's own fetched .status the same
// way useLivePresence does: presence.get(id) ?? person.status.
export function usePresenceMap(): Map<string, string> {
  return useContext(PresenceContext);
}
