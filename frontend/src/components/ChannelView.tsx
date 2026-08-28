import { useEffect, useRef, useState } from 'react';
import { channelsApi, type Channel, type Message } from '../api/resources';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';

interface ChannelViewProps {
  channel: Channel;
}

// The live conversation for one channel. History loads over REST; new
// messages arrive over the socket. This mirrors the backend split exactly:
// REST for reading the past, WebSocket for the live present.
export default function ChannelView({ channel }: ChannelViewProps) {
  const socket = useSocket();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [typingUser, setTypingUser] = useState<string | null>(null);
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
    function onTyping(t: { channelId: string; userId: string; typing: boolean }) {
      if (t.channelId === channel.id && t.userId !== user?.id) {
        setTypingUser(t.typing ? t.userId : null);
      }
    }

    socket.on('message:new', onNew);
    socket.on('typing:update', onTyping);

    return () => {
      socket.emit('channel:leave', channel.id);
      socket.off('message:new', onNew);
      socket.off('typing:update', onTyping);
    };
  }, [socket, channel.id, user?.id]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          <span className="chan-hash">{channel.is_private ? '🔒' : '#'}</span>
          {channel.name}
        </h2>
      </header>

      <div className="chan-messages">
        {messages.map((m) => (
          <div key={m.id} className="msg">
            <div className="msg-avatar">
              {(m.sender_name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="msg-body">
              <div className="msg-meta">
                <span className="msg-author">{m.sender_name || 'Unknown'}</span>
                <span className="msg-time">
                  {new Date(m.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                {m.edited_at && <span className="msg-edited">edited</span>}
              </div>
              <div className={`msg-text ${m.deleted_at ? 'is-deleted' : ''}`}>
                {m.content}
              </div>
            </div>
          </div>
        ))}
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
          placeholder={`Message ${channel.is_private ? '' : '#'}${channel.name}`}
        />
        <button onClick={send} disabled={!draft.trim()}>Send</button>
      </div>
    </section>
  );
}
