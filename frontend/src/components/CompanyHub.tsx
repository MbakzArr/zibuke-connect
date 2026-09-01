import { useEffect, useState } from 'react';
import {
  announcementsApi,
  directoryApi,
  channelsApi,
  reactionsApi,
  messagesApi,
  eventsApi,
  type Announcement,
  type Person,
  type Birthday,
  type Channel,
  type ReactionsMap,
  type RecentConversation,
  type Event,
} from '../api/resources';
import { useAuth } from '../context/AuthContext';
import { colorFor } from '../util/avatarColor';
import Reactions from './Reactions';
import AnnouncementModal from './AnnouncementModal';

interface CompanyHubProps {
  onOpenChannel: (channel: Channel) => void;
  onMessagePerson: (person: Person) => void;
  onOpenConversation: (channelId: string) => void; // jump to a recent chat
  myName?: string; // for the personalized greeting
}

// Good morning/afternoon/evening based on the visitor's local clock.
function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// Short relative time ("2m", "3h", "Yesterday") for the recent chats list.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d`;
}

// Always shows the time in SAST (Africa/Johannesburg), regardless of the
// viewer's own device timezone, per the "one consistent timezone for now"
// decision.
function formatSAST(iso: string): string {
  return new Intl.DateTimeFormat('en-ZA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

// The landing screen. A richer overview than a bare feed: a personalized
// greeting, an announcements column, and a right rail with who's online,
// today's birthdays, recent conversations, and quick access to your
// channels. Everything here is backed by real data from the API - nothing
// is mocked (no fake calendar/meeting data).
export default function CompanyHub({ onOpenChannel, onMessagePerson, onOpenConversation, myName }: CompanyHubProps) {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [annReactions, setAnnReactions] = useState<ReactionsMap>({});
  const [bdayReactions, setBdayReactions] = useState<ReactionsMap>({});
  const [openAnn, setOpenAnn] = useState<Announcement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      announcementsApi.list().then((d) => {
        setAnnouncements(d.announcements);
        const ids = d.announcements.map((a) => a.id);
        if (ids.length > 0) {
          reactionsApi.list('announcement', ids).then((r) => setAnnReactions(r.reactions));
        }
      }),
      directoryApi.list().then((d) => setPeople(d.people)),
      directoryApi.birthdays().then((d) => {
        setBirthdays(d.birthdays);
        const ids = d.birthdays.map((b) => b.id);
        if (ids.length > 0) {
          reactionsApi.list('birthday', ids).then((r) => setBdayReactions(r.reactions));
        }
      }),
      channelsApi.list().then((d) => setChannels(d.channels)),
      messagesApi.recent().then((d) => setRecent(d.conversations)),
      eventsApi.today().then((d) => setEvents(d.events)),
    ]).then((results) => {
      if (cancelled) return;
      // If any one section failed to load, show a small non-blocking notice
      // rather than a broken page - the sections that DID load still work.
      if (results.some((r) => r.status === 'rejected')) setLoadError(true);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const online = people.filter((p) => p.status === 'online');
  const isAdmin = user?.role === 'admin' || user?.role === 'department_admin';
  const todayLabel = new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());

  return (
    <section className="hub">
      <div className="hub-hero">
        <div>
          <p className="hub-eyebrow">Company Hub</p>
          <h1 className="hub-greeting">
            {timeGreeting()}{myName ? `, ${myName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="hub-tagline">Here's what's happening across Zibuke today.</p>
          <p className="hub-date">{todayLabel}</p>
        </div>
        <div className="hub-status-pill">
          <span className="hub-status-dot" />
          Available
        </div>
      </div>

      {loadError && (
        <div className="hub-error" role="alert">
          Some Company Hub information couldn't be loaded, but everything else below is up to date.
        </div>
      )}

      {loading ? (
        <div className="hub-skeleton">
          <div className="hub-skeleton-row" />
          <div className="hub-skeleton-row" />
          <div className="hub-skeleton-row" />
        </div>
      ) : (
        <>
          <div className="hub-stat-grid">
            <div className="hub-stat-card">
              <span className="hub-stat-icon">💬</span>
              <div><strong>{channels.length}</strong><span>Channels</span></div>
            </div>
            <div className="hub-stat-card">
              <span className="hub-stat-icon">👥</span>
              <div><strong>{people.length}</strong><span>Employees</span></div>
            </div>
            <div className="hub-stat-card">
              <span className="hub-stat-icon">🟢</span>
              <div><strong>{online.length}</strong><span>Online now</span></div>
            </div>
            <div className="hub-stat-card">
              <span className="hub-stat-icon">📢</span>
              <div><strong>{announcements.length}</strong><span>Announcements</span></div>
            </div>
          </div>

      <div className="hub-grid">
        {/* Row 1: Announcements, People online */}
        <div className="hub-card">
          <div className="hub-card-head">
            <h3>Announcements</h3>
            {isAdmin && (
              <NewAnnouncement onPosted={(a) => setAnnouncements((prev) => [a, ...prev])} />
            )}
          </div>
          {announcements.length === 0 && <p className="hub-muted">No announcements yet.</p>}
          {announcements.map((a) => (
            <div key={a.id} className="hub-ann">
              <button className="hub-ann-open" onClick={() => setOpenAnn(a)}>
                <div className="hub-ann-title">{a.title}</div>
                <div className="hub-ann-body">{a.content}</div>
                <div className="hub-ann-meta">
                  {a.author_name} · {new Date(a.created_at).toLocaleDateString()}
                </div>
              </button>
              <Reactions targetType="announcement" targetId={a.id} initial={annReactions[a.id]} />
            </div>
          ))}
        </div>

        <div className="hub-card">
          <div className="hub-card-head">
            <h3>People online</h3>
            <span className="hub-count">{online.length}</span>
          </div>
          <ul className="hub-people">
            {people.map((p) => (
              <li key={p.id}>
                <button className="hub-person hub-person-btn" onClick={() => onMessagePerson(p)}>
                  <span className={`hub-dot ${p.status === 'online' ? 'is-on' : ''}`} />
                  <span className="hub-avatar" style={{ background: colorFor(p.id) }}>
                    {(p.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="hub-person-info">
                    <span className="hub-person-name">{p.full_name || p.email}</span>
                    {p.job_title && <span className="hub-person-role">{p.job_title}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Row 2: Celebrate, Recent conversations - only rendered when there's
            something real to show, so the grid doesn't leave an empty gap. */}
        {birthdays.length > 0 && (
          <div className="hub-card hub-celebrate">
            <div className="hub-card-head">
              <h3>🎉 Celebrate today</h3>
            </div>
            <div className="hub-bday-row">
              {birthdays.map((b) => (
                <div key={b.id} className="hub-bday">
                  <span className="hub-avatar" style={{ background: colorFor(b.id) }}>
                    {(b.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="hub-bday-info">
                    <div className="hub-bday-name">{b.full_name}</div>
                    <div className="hub-bday-note">🎂 Birthday today</div>
                    <div className="hub-bday-actions">
                      <Reactions targetType="birthday" targetId={b.id} initial={bdayReactions[b.id]} />
                      {b.id !== user?.id && (
                        <button
                          className="hub-bday-msg"
                          onClick={() =>
                            onMessagePerson({
                              id: b.id,
                              email: '',
                              status: 'offline',
                              full_name: b.full_name,
                              job_title: b.job_title,
                              department_name: b.department_name,
                            })
                          }
                        >
                          Message
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="hub-card">
            <div className="hub-card-head">
              <h3>Recent conversations</h3>
            </div>
            <ul className="hub-recent-list">
              {recent.map((r) => {
                const label = r.is_dm ? (r.other_name || 'Direct message') : `#${r.channel_name}`;
                return (
                  <li key={r.channel_id}>
                    <button className="hub-recent" onClick={() => onOpenConversation(r.channel_id)}>
                      <span className="hub-recent-top">
                        <span className="hub-recent-label">{label}</span>
                        <span className="hub-recent-time">{timeAgo(r.created_at)}</span>
                      </span>
                      <span className="hub-recent-preview">
                        {r.is_dm ? '' : `${r.sender_name || 'Someone'}: `}
                        {r.content}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Your channels: full-width row of its own below the 2x2, since it
          doesn't naturally pair with anything else. */}
      <div className="hub-card hub-full-row">
        <div className="hub-card-head">
          <h3>Your channels</h3>
        </div>
        <ul className="hub-chan-list hub-chan-list-row">
          {channels.map((c) => (
            <li key={c.id}>
              <button className="hub-chan" onClick={() => onOpenChannel(c)}>
                <span className="hub-chan-hash">{c.is_private ? '🔒' : '#'}</span>
                <span className="hub-chan-name">{c.name}</span>
                {c.member_count && <span className="hub-chan-count">{c.member_count}</span>}
              </button>
            </li>
          ))}
          {channels.length === 0 && <li className="hub-muted">No channels yet.</li>}
        </ul>
      </div>

      <div className="hub-card hub-day-card">
        <div className="hub-card-head">
          <h3>📅 Your day <span className="hub-day-tz">(SAST)</span></h3>
          <AddEventForm onCreated={(e) => setEvents((prev) => [...prev, e].sort((a, b) => a.starts_at.localeCompare(b.starts_at)))} />
        </div>
        {events.length === 0 && <p className="hub-muted">Nothing scheduled for today.</p>}
        <ul className="hub-day-list">
          {events.map((e) => (
            <li key={e.id} className="hub-day-item">
              <span className="hub-day-time">{formatSAST(e.starts_at)}</span>
              <span className="hub-day-title">{e.title}</span>
              {e.author_name && <span className="hub-day-author">{e.author_name}</span>}
            </li>
          ))}
        </ul>
      </div>
        </>
      )}

      {openAnn && (
        <AnnouncementModal
          announcement={openAnn}
          reactions={annReactions[openAnn.id]}
          onClose={() => setOpenAnn(null)}
        />
      )}
    </section>
  );
}

// Small inline form to add a "today" event. The time input is treated as
// SAST explicitly (not the browser's local timezone) - since SAST has a
// fixed +2 offset with no daylight saving, appending "+02:00" to whatever
// time the user types converts it to the correct UTC instant every time.
function AddEventForm({ onCreated }: { onCreated: (e: Event) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim() || !time) return;
    setBusy(true);
    try {
      // "YYYY-MM-DD" for today, combined with the chosen HH:mm, explicitly
      // in SAST (+02:00, fixed, no DST).
      const todayDate = new Date().toISOString().slice(0, 10);
      const startsAt = `${todayDate}T${time}:00+02:00`;
      const { event } = await eventsApi.create(title.trim(), startsAt);
      onCreated(event);
      setTitle('');
      setTime('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="hub-post-btn" onClick={() => setOpen(true)}>
        + Add
      </button>
    );
  }

  return (
    <div className="hub-event-form">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />
      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      <button className="hub-post-cancel" onClick={() => setOpen(false)}>Cancel</button>
      <button className="hub-post-send" onClick={submit} disabled={busy}>
        {busy ? 'Adding...' : 'Add'}
      </button>
    </div>
  );
}

function NewAnnouncement({ onPosted }: { onPosted: (a: Announcement) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function post() {
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      const { announcement } = await announcementsApi.create(title.trim(), content.trim());
      onPosted(announcement);
      setTitle('');
      setContent('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <button className="hub-post-btn" onClick={() => setOpen(true)}>Post</button>;
  }

  return (
    <div className="hub-post-form">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What would you like to share?"
        rows={2}
      />
      <div className="hub-post-actions">
        <button className="hub-post-cancel" onClick={() => setOpen(false)}>Cancel</button>
        <button className="hub-post-send" onClick={post} disabled={busy}>
          {busy ? 'Posting...' : 'Post announcement'}
        </button>
      </div>
    </div>
  );
}
