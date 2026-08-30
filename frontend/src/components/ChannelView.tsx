import { useEffect, useRef, useState } from 'react';
import { channelsApi, messagesApi, type Channel, type Message } from '../api/resources';
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
      </header>

      <div className="chan-messages">
        {messages.map((m, i) => {
          const mine = m.user_id === user?.id;
          // Group consecutive messages from the same person: hide the
          // avatar and name on follow-on messages so a run reads as one block.
          const prev = messages[i - 1];
          const grouped = prev && prev.user_id === m.user_id;
          return (
            <div key={m.id} className={`row ${mine ? 'row-mine' : 'row-theirs'} ${grouped ? 'row-grouped' : ''}`}>
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
