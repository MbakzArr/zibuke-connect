import { useEffect, useRef, useState } from 'react';
import { channelsApi, messagesApi, reactionsApi, directoryApi, type Channel, type Message, type MessageSearchResult, type ReactionsMap } from '../api/resources';
import { statusColor, statusLabel } from '../util/status';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { colorFor } from '../util/avatarColor';
import MembersModal from './MembersModal';
import ProfileModal from './ProfileModal';
import Reactions from './Reactions';

interface ChannelViewProps {
  channel: Channel;
  dmTitle?: string; // when set, this is a DM and we show the person's name
  dmUserId?: string; // the other person's user id, for viewing their profile
  jumpToId?: string; // when set, scroll to and flash this message after load
  onOpenDm?: (userId: string, name: string) => void; // open a DM (from a profile)
  onBack?: () => void; // mobile: return to the Company Hub
}

// The live conversation for one channel. History loads over REST; new
// messages arrive over the socket. This mirrors the backend split exactly:
// REST for reading the past, WebSocket for the live present.
export default function ChannelView({ channel, dmTitle, dmUserId, jumpToId, onOpenDm, onBack }: ChannelViewProps) {
  const socket = useSocket();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgReactions, setMsgReactions] = useState<ReactionsMap>({});
  const [draft, setDraft] = useState('');
  const [typingName, setTypingName] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [dmStatus, setDmStatus] = useState<{ status: string; availability: string | null } | null>(null);
  // When did the OTHER person in this DM last read it - drives the
  // Sent/Seen tick on your own most recent message. Only meaningful for a
  // 1:1 DM, not a group channel (there's no single "seen by" there).
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);

  // Fetch the other person's live status when a DM is opened, so the header
  // shows a real "Available"/"Busy"/"Away"/"Offline" instead of nothing.
  useEffect(() => {
    if (!dmUserId) {
      setDmStatus(null);
      return;
    }
    let cancelled = false;
    directoryApi.profile(dmUserId).then((d) => {
      if (!cancelled) setDmStatus({ status: d.profile.status, availability: d.profile.availability || null });
    });
    return () => {
      cancelled = true;
    };
  }, [dmUserId]);

  // Live update if the DM partner changes their status while this DM is open.
  useEffect(() => {
    if (!socket || !dmUserId) return;
    function onAvailability(p: { userId: string; availability: string }) {
      if (p.userId === dmUserId) {
        setDmStatus((prev) => (prev ? { ...prev, availability: p.availability } : prev));
      }
    }
    socket.on('availability:update', onAvailability);
    return () => {
      socket.off('availability:update', onAvailability);
    };
  }, [socket, dmUserId]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load history whenever the channel changes. History comes back newest
  // first, so we reverse it to show oldest-at-top like a normal chat.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await channelsApi.history(channel.id);
      if (!cancelled) {
        const msgs = data.messages.slice().reverse();
        setMessages(msgs);
        // Load reactions for these messages in one call.
        const ids = msgs.filter((m) => !m.deleted_at).map((m) => m.id);
        if (ids.length > 0) {
          reactionsApi.list('message', ids).then((r) => {
            if (!cancelled) setMsgReactions(r.reactions);
          });
        }
      }
    }
    load();
    // Mark it read on the server (updates channel_reads, which is also
    // what the "Seen" tick on the OTHER person's screen reads from).
    channelsApi.markRead(channel.id).catch(() => {
      // best-effort; a failed mark-read just leaves the badge showing
    });
    return () => {
      cancelled = true;
    };
  }, [channel.id]);

  // For a DM, load who last read it (for the Sent/Seen tick), then keep it
  // live via the socket - the moment the other person opens this
  // conversation, your last message should flip to "Seen" without a reload.
  useEffect(() => {
    if (!dmTitle) {
      setOtherReadAt(null);
      return;
    }
    let cancelled = false;
    channelsApi.readStatus(channel.id).then((d) => {
      if (!cancelled) setOtherReadAt(d.otherLastReadAt);
    }).catch(() => {
      // best-effort; ticks just won't show if this fails
    });
    return () => {
      cancelled = true;
    };
  }, [channel.id, dmTitle]);

  useEffect(() => {
    if (!socket) return;
    function onRead(p: { channelId: string; userId: string; lastReadAt: string }) {
      if (p.channelId === channel.id && p.userId !== user?.id) {
        setOtherReadAt(p.lastReadAt);
      }
    }
    socket.on('channel:read', onRead);
    return () => {
      socket.off('channel:read', onRead);
    };
  }, [socket, channel.id, user?.id]);

  // Join the channel's live room and subscribe to new messages + typing.
  useEffect(() => {
    if (!socket) return;

    socket.emit('channel:join', channel.id);

    function onNew(msg: Message) {
      if (msg.channel_id === channel.id) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    // An edit or delete from anyone: replace the message in place.
    function onUpdated(msg: Message) {
      if (msg.channel_id === channel.id) {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
      }
    }
    function onTyping(t: { channelId: string; userId: string; name?: string; typing: boolean }) {
      if (t.channelId === channel.id && t.userId !== user?.id) {
        setTypingName(t.typing ? (t.name || 'Someone') : null);
      }
    }

    socket.on('message:new', onNew);
    socket.on('message:updated', onUpdated);
    socket.on('typing:update', onTyping);

    return () => {
      socket.emit('channel:leave', channel.id);
      socket.off('message:new', onNew);
      socket.off('message:updated', onUpdated);
      socket.off('typing:update', onTyping);
    };
  }, [socket, channel.id, user?.id]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function startEdit(m: Message) {
    setEditingId(m.id);
    setEditDraft(m.content);
  }

  // In-channel search: scoped to THIS channel via the channelId param.
  async function runChannelSearch(q: string) {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const { results } = await messagesApi.search(q.trim(), channel.id);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }

  // Jump to a message from the search results. If it's already loaded, scroll
  // to it. If it's older than what's currently loaded, fetch history back to
  // its time first so it's in the DOM, then scroll. Either way, flash a
  // highlight so it's easy to spot.
  // Scroll to a message by id and flash it. Shared by in-channel search and
  // the global-search jump (via the jumpToId prop).
  function scrollToAndFlash(id: string) {
    setTimeout(() => {
      const el = document.getElementById(`msg-${id}`);
      const container = messagesRef.current;
      if (!el || !container) {
        return;
      }
      // Absolute scroll: position the message near the middle of the
      // container. offsetTop is relative to the container (its offset parent),
      // so this works no matter where we're currently scrolled.
      const target = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });

      // Highlight directly on the element rather than via a CSS animation +
      // React state, which can fail to re-trigger. Set a bright background,
      // then fade it out with a transition. Reliable every time.
      el.style.transition = 'none';
      el.style.borderRadius = 'var(--radius)';
      el.style.boxShadow = 'inset 3px 0 0 var(--indigo-600)';
      el.style.background = '#c9d1ff';
      void el.offsetWidth; // force reflow so the fade animates
      el.style.transition = 'background 2s ease-out';
      el.style.background = 'transparent';
      window.setTimeout(() => {
        el.style.boxShadow = '';
        el.style.borderRadius = '';
        el.style.transition = '';
        el.style.background = '';
      }, 2200);
    }, 150);
  }

  // Ensure a message is loaded (fetching older history if needed), then jump.
  async function loadThenJump(id: string, createdAt?: string) {
    const alreadyLoaded = messages.some((m) => m.id === id);
    if (!alreadyLoaded && createdAt) {
      try {
        const justAfter = new Date(new Date(createdAt).getTime() + 1000).toISOString();
        const { messages: older } = await channelsApi.history(channel.id, justAfter);
        setMessages((prev) => {
          const byId = new Map<string, Message>();
          for (const m of older.slice().reverse()) byId.set(m.id, m);
          for (const m of prev) byId.set(m.id, m);
          return Array.from(byId.values()).sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });
      } catch {
        // fall through and try to scroll to whatever's loaded
      }
    }
    scrollToAndFlash(id);
  }

  async function jumpToMessage(result: MessageSearchResult) {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    await loadThenJump(result.id, result.created_at);
  }

  // When opened from global search with a target message, jump to it once the
  // channel's history has loaded. We don't have the message's timestamp here,
  // so this jumps if it's in the loaded window; recent messages (the common
  // case) are covered. Runs whenever jumpToId changes.
  useEffect(() => {
    if (jumpToId && messages.length > 0) {
      scrollToAndFlash(jumpToId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToId, messages.length]);

  function cancelEdit() {
    setEditingId(null);
    setEditDraft('');
  }

  async function saveEdit(id: string) {
    const content = editDraft.trim();
    if (!content) return;
    try {
      const { message } = await messagesApi.edit(id, content);
      // Update locally right away; the socket broadcast also updates others.
      setMessages((prev) => prev.map((m) => (m.id === id ? message : m)));
      setEditingId(null);
      setEditDraft('');
    } catch (err: any) {
      // Leave the edit box open so the user can retry, and say why it failed.
      showToast(err?.message || 'Could not save that edit. Try again.', { type: 'error' });
    }
  }

  async function remove(id: string) {
    try {
      const { message } = await messagesApi.remove(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? message : m)));
      showToast('Message deleted', {
        type: 'success',
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const { message: restored } = await messagesApi.restore(id);
              setMessages((prev) => prev.map((m) => (m.id === id ? restored : m)));
            } catch (err: any) {
              showToast(err?.message || 'Could not undo that delete.', { type: 'error' });
            }
          },
        },
      });
    } catch (err: any) {
      showToast(err?.message || 'Could not delete that message.', { type: 'error' });
    }
  }

  function send() {
    const content = draft.trim();
    if (!content || !socket) return;
    socket.emit('message:send', { channelId: channel.id, content });
    socket.emit('typing:stop', channel.id);
    setDraft('');
  }

  function handleTyping(value: string) {
    setDraft(value);
    if (!socket) return;
    socket.emit('typing:start', channel.id);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing:stop', channel.id);
    }, 1500);
  }

  return (
    <section className="chan">
      <header className="chan-head">
        {onBack && (
          <button className="chan-back-btn" onClick={onBack} aria-label="Back to Company Hub">
            ←
          </button>
        )}
        {dmTitle ? (
          <div className="chan-dm-title-wrap">
            <button
              className="chan-title chan-title-clickable"
              onClick={() => dmUserId && setProfileUserId(dmUserId)}
              disabled={!dmUserId}
              title={dmUserId ? 'View profile' : undefined}
            >
              <span className="chan-dm-icon">@</span>
              {dmTitle}
            </button>
            {dmStatus && (
              <span className="chan-dm-status">
                <span className="chan-dm-status-dot" style={{ background: statusColor(dmStatus.status, dmStatus.availability) }} />
                {statusLabel(dmStatus.status, dmStatus.availability)}
              </span>
            )}
          </div>
        ) : (
          <h2 className="chan-title">
            <span className="chan-hash">{channel.is_private ? '🔒' : '#'}</span>
            {channel.name}
          </h2>
        )}
        <div className="chan-head-actions">
          {!dmTitle && (
            <button className="chan-members-btn" onClick={() => setShowMembers(true)} title="View members">
              👥 Members
            </button>
          )}
          <div className="chan-search">
          <button
            className="chan-search-btn"
            onClick={() => {
              setSearchOpen((o) => !o);
              setSearchQuery('');
              setSearchResults([]);
            }}
            title="Search this conversation"
          >
            🔍
          </button>
          {searchOpen && (
            <div className="chan-search-panel">
              <input
                className="chan-search-input"
                value={searchQuery}
                onChange={(e) => runChannelSearch(e.target.value)}
                placeholder={`Search in ${dmTitle ? dmTitle : '#' + channel.name}`}
                autoFocus
              />
              {searchQuery.trim().length >= 2 && (
                <div className="chan-search-results">
                  {searchResults.length === 0 && (
                    <div className="chan-search-empty">No matches in this conversation.</div>
                  )}
                  {searchResults.map((r) => (
                    <button key={r.id} className="chan-search-result" onClick={() => jumpToMessage(r)}>
                      <span className="chan-search-result-text">{r.content}</span>
                      <span className="chan-search-result-meta">
                        {r.sender_name} · {new Date(r.created_at).toLocaleDateString()}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </header>

      <div className="chan-messages" ref={messagesRef}>
        {(() => {
          // Only the most recent message YOU sent gets a Sent/Seen tick,
          // WhatsApp-style - not every message, that would be noisy. Only
          // meaningful in a 1:1 DM, where "seen by" is unambiguous.
          const lastMineIndex = dmTitle
            ? messages.reduce((acc, m, idx) => (m.user_id === user?.id ? idx : acc), -1)
            : -1;
          return messages.map((m, i) => {
          const mine = m.user_id === user?.id;
          // Group consecutive messages from the same person: hide the
          // avatar and name on follow-on messages so a run reads as one block.
          const prev = messages[i - 1];
          const grouped = prev && prev.user_id === m.user_id;
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={`row ${mine ? 'row-mine' : 'row-theirs'} ${grouped ? 'row-grouped' : ''}`}
            >
              {!mine && !grouped ? (
                <button className="msg-avatar msg-avatar-btn" style={{ background: colorFor(m.user_id) }} onClick={() => setProfileUserId(m.user_id)} title="View profile">
                  {(m.sender_name || '?').charAt(0).toUpperCase()}
                </button>
              ) : (
                <div className="msg-avatar-spacer" />
              )}
              <div className="bubble-wrap">
                {!grouped ? (
                  <div className={`msg-meta ${mine ? 'meta-mine' : ''}`}>
                    {mine ? (
                      <span className="msg-author">You</span>
                    ) : (
                      <button className="msg-author msg-author-btn" onClick={() => setProfileUserId(m.user_id)}>
                        {m.sender_name || 'Unknown'}
                      </button>
                    )}
                    <span className="msg-time">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {m.edited_at && <span className="msg-edited">edited</span>}
                  </div>
                ) : (
                  // Grouped follow-on messages skip the full author/time
                  // header, but every individual message still gets its
                  // own timestamp - just a smaller, quieter one.
                  <span className={`msg-time-grouped ${mine ? 'msg-time-grouped-mine' : ''}`}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {m.edited_at && ' · edited'}
                  </span>
                )}
                {editingId === m.id ? (
                  <div className="bubble-edit">
                    <input
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(m.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                    />
                    <div className="bubble-edit-actions">
                      <button className="bubble-edit-save" onClick={() => saveEdit(m.id)}>Save</button>
                      <button className="bubble-edit-cancel" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="bubble-line">
                    <div className={`bubble ${mine ? 'bubble-mine' : 'bubble-theirs'} ${m.deleted_at ? 'is-deleted' : ''}`}>
                      {m.content}
                    </div>
                    {/* Edit/delete only on your own, non-deleted messages */}
                    {mine && !m.deleted_at && (
                      <div className="msg-actions">
                        <button className="msg-action" onClick={() => startEdit(m)} title="Edit">✏️</button>
                        <button className="msg-action" onClick={() => remove(m.id)} title="Delete">🗑️</button>
                      </div>
                    )}
                  </div>
                )}
                {/* Message reactions: show on hover (or always if it has any) */}
                {!m.deleted_at && editingId !== m.id && (
                  <div className="msg-reactions">
                    <Reactions targetType="message" targetId={m.id} initial={msgReactions[m.id]} />
                  </div>
                )}
                {/* Sent/Seen tick - only on your own latest message in a DM. */}
                {i === lastMineIndex && (
                  <span className="msg-status">
                    {otherReadAt && new Date(otherReadAt) >= new Date(m.created_at) ? (
                      <span className="msg-status-seen">✓✓ Seen</span>
                    ) : (
                      <span className="msg-status-sent">✓ Sent</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          );
          });
        })()}
        {messages.length === 0 && (
          <div className="chan-empty">
            No messages yet. Say something to start the conversation.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chan-typing">
        {typingName ? `${typingName} is typing...` : '\u00a0'}
      </div>

      <div className="chan-composer">
        <div className="chan-composer-inner">
          <input
            value={draft}
            onChange={(e) => handleTyping(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder={dmTitle ? `Message ${dmTitle}` : `Message ${channel.is_private ? '' : '#'}${channel.name}`}
          />
          <button onClick={send} disabled={!draft.trim()}>Send</button>
        </div>
      </div>

      {showMembers && (
        <MembersModal
          channelId={channel.id}
          channelName={channel.name}
          onClose={() => setShowMembers(false)}
          onViewProfile={(userId) => {
            setShowMembers(false);
            setProfileUserId(userId);
          }}
        />
      )}

      {profileUserId && (
        <ProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onMessage={
            onOpenDm
              ? (userId, name) => {
                  setProfileUserId(null);
                  onOpenDm(userId, name);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
