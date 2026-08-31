import { useEffect, useState } from 'react';
import { reactionsApi, type ReactionCounts } from '../api/resources';
import { useSocket } from '../context/SocketContext';

// The fixed, minimal emoji set. Matches the server's allowed list.
const EMOJI = ['🎉', '👍', '❤️', '🥳', '👏'];

interface ReactionsProps {
  targetType: 'announcement' | 'birthday' | 'message';
  targetId: string;
  initial?: ReactionCounts;
}

// One reaction per person per item. At rest you see reactions that have a
// count. If YOU haven't reacted, a "React" button offers the palette. Once you
// pick one, the palette/button goes away - to change it you remove yours
// first, which brings the button back. Swappable, never stacked. Counts update
// live for everyone via the reaction:update socket event.
export default function Reactions({ targetType, targetId, initial }: ReactionsProps) {
  const [counts, setCounts] = useState<ReactionCounts>(initial || {});
  const [pickerOpen, setPickerOpen] = useState(false);
  const socket = useSocket();

  // The `initial` counts often arrive AFTER this component first mounts (the
  // parent loads them asynchronously). useState only reads initial once, so
  // sync when it changes, otherwise reactions look empty until a live update.
  useEffect(() => {
    if (initial) setCounts(initial);
  }, [initial]);

  // Live update: when anyone reacts to this target, refresh its counts. The
  // server sends the full fresh count set, but it computes "reacted" from the
  // reactor's perspective, so we only trust the counts and keep our own
  // "reacted" flags intact by merging.
  useEffect(() => {
    if (!socket) return;
    function onUpdate(p: { targetType: string; targetId: string; counts: ReactionCounts }) {
      if (p.targetType !== targetType || p.targetId !== targetId) return;
      setCounts((prev) => {
        const merged: ReactionCounts = {};
        for (const e of EMOJI) {
          const incoming = p.counts[e];
          const mine = prev[e]?.reacted || false;
          if (incoming) {
            merged[e] = { count: incoming.count, reacted: mine };
          }
        }
        return merged;
      });
    }
    socket.on('reaction:update', onUpdate);
    return () => {
      socket.off('reaction:update', onUpdate);
    };
  }, [socket, targetType, targetId]);

  // Which emoji (if any) this user has currently reacted with.
  const myEmoji = EMOJI.find((e) => counts[e]?.reacted) || null;

  async function react(emoji: string) {
    setPickerOpen(false);
    const wasMine = counts[emoji]?.reacted;

    // Optimistic: if clicking my own reaction, remove it. Otherwise switch to
    // this emoji (decrement my previous one, increment the new).
    setCounts((prev) => {
      const next = { ...prev };
      // Remove my previous reaction, if any and different.
      if (myEmoji && myEmoji !== emoji) {
        const p = next[myEmoji] || { count: 0, reacted: false };
        next[myEmoji] = { count: Math.max(0, p.count - 1), reacted: false };
      }
      const cur = next[emoji] || { count: 0, reacted: false };
      if (wasMine) {
        next[emoji] = { count: Math.max(0, cur.count - 1), reacted: false };
      } else {
        next[emoji] = { count: cur.count + 1, reacted: true };
      }
      return next;
    });

    try {
      await reactionsApi.toggle(targetType, targetId, emoji);
    } catch {
      // Best-effort revert: reload would be cleaner, but flip the clicked one back.
      setCounts((prev) => {
        const cur = prev[emoji] || { count: 0, reacted: false };
        const reacted = !cur.reacted;
        const count = cur.count + (reacted ? 1 : -1);
        return { ...prev, [emoji]: { count: Math.max(0, count), reacted } };
      });
    }
  }

  // Show any emoji that has a count.
  const active = EMOJI.filter((e) => (counts[e]?.count || 0) > 0);

  return (
    <div className="reactions">
      {active.map((emoji) => {
        const c = counts[emoji];
        return (
          <button
            key={emoji}
            className={`reaction has-count ${c?.reacted ? 'is-reacted' : ''}`}
            onClick={() => react(emoji)}
            title={c?.reacted ? 'Remove your reaction' : undefined}
          >
            <span className="reaction-emoji">{emoji}</span>
            <span className="reaction-count">{c?.count || 0}</span>
          </button>
        );
      })}

      {/* Only offer the palette if the user hasn't reacted yet. */}
      {!myEmoji && (
        <div className="reaction-add-wrap">
          <button className="reaction-add" onClick={() => setPickerOpen((o) => !o)} title="Add a reaction">
            {active.length === 0 ? '☺ React' : '+'}
          </button>
          {pickerOpen && (
            <>
              <div className="reaction-picker-overlay" onClick={() => setPickerOpen(false)} />
              <div className="reaction-picker">
                {EMOJI.map((emoji) => (
                  <button key={emoji} className="reaction-pick" onClick={() => react(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
