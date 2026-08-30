import { useEffect, useRef, useState } from 'react';
import { channelsApi, messagesApi, type Channel, type Message, type MessageSearchResult } from '../api/resources';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { colorFor } from '../util/avatarColor';

interface ChannelViewProps {
  channel: Channel;
  dmTitle?: string; // when set, this is a DM and we show the person's name
}

// The live conversation for one channel. History loads over REST; new
// messages arrive over the socket. This mirrors the backend split exactly:
// REST for reading the past, WebSocket for the live present.
export default function ChannelView({ channel, dmTitle }: ChannelViewProps) {
  const socket = useSocket();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load history whenever the channel changes. History comes back newest
  // first, so we reverse it to show oldest-at-top like a normal chat.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await channelsApi.history(channel.id);
      if (!cancelled) setMessages(data.messages.slice().reverse());
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [channel.id]);

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
    function onTyping(t: { channelId: string; userId: string; typing: boolean }) {
      if (t.channelId === channel.id && t.userId !== user?.id) {
        setTypingUser(t.typing ? t.userId : null);
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

  // Jump to a message from the search results: scroll to it and flash a
  // highlight. If it's not currently loaded (older than what's in view) we
  // can't scroll to it, so this is best-effort on loaded messages.
  function jumpToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightId(id);
      setTimeout(() => setHighlightId(null), 2000);
    }
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }

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
    } catch (err) {
      // Leave the edit box open so the user can retry.
      console.error(err);
    }
    setEditingId(null);
    setEditDraft('');
  }

  async function remove(id: string) {
    try {
      const { message } = await messagesApi.remove(id);
      setMessages((prev) => prev.map((m) => (m.id === id ? message : m)));
    } catch (err) {
      console.error(err);
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
        <h2 className="chan-title">
          {dmTitle ? (
            <>
              <span className="chan-dm-icon">@</span>
              {dmTitle}
            </>
          ) : (
            <>
              <span className="chan-hash">{channel.is_private ? '🔒' : '#'}</span>
              {channel.name}
            </>
          )}
        </h2>
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
                    <button key={r.id} className="chan-search-result" onClick={() => jumpToMessage(r.id)}>
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
      </header>

      <div className="chan-messages">
        {messages.map((m, i) => {
          const mine = m.user_id === user?.id;
          // Group consecutive messages from the same person: hide the
          // avatar and name on follow-on messages so a run reads as one block.
          const prev = messages[i - 1];
          const grouped = prev && prev.user_id === m.user_id;
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={`row ${mine ? 'row-mine' : 'row-theirs'} ${grouped ? 'row-grouped' : ''} ${highlightId === m.id ? 'row-highlight' : ''}`}
            >
              {!mine && !grouped ? (
                <div className="msg-avatar" style={{ background: colorFor(m.user_id) }}>
                  {(m.sender_name || '?').charAt(0).toUpperCase()}
                </div>
              ) : (
                <div className="msg-avatar-spacer" />
              )}
              <div className="bubble-wrap">
                {!grouped && (
                  <div className={`msg-meta ${mine ? 'meta-mine' : ''}`}>
                    <span className="msg-author">{mine ? 'You' : m.sender_name || 'Unknown'}</span>
                    <span className="msg-time">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {m.edited_at && <span className="msg-edited">edited</span>}
                  </div>
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
              </div>
            </div>
          );
        })}
        {messages.length === 0 && (
          <div className="chan-empty">
            No messages yet. Say something to start the conversation.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chan-typing">
        {typingUser ? 'Someone is typing...' : '\u00a0'}
      </div>

      <div className="chan-composer">
        <input
          value={draft}
          onChange={(e) => handleTyping(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={dmTitle ? `Message ${dmTitle}` : `Message ${channel.is_private ? '' : '#'}${channel.name}`}
        />
        <button onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </section>
  );
}
