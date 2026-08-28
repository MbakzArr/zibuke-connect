import { useEffect, useState } from 'react';
import {
  announcementsApi,
  directoryApi,
  channelsApi,
  type Announcement,
  type Person,
  type Birthday,
  type Channel,
} from '../api/resources';
import { useAuth } from '../context/AuthContext';
import { colorFor } from '../util/avatarColor';

interface CompanyHubProps {
  onOpenChannel: (channel: Channel) => void;
}

// The landing screen. A richer overview than a bare feed: a greeting, an
// announcements column, and a right rail with who's online, today's
// birthdays, and quick access to your channels. Everything here is backed by
// real data from the API, nothing is mocked.
export default function CompanyHub({ onOpenChannel }: CompanyHubProps) {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);

  useEffect(() => {
    announcementsApi.list().then((d) => setAnnouncements(d.announcements));
    directoryApi.list().then((d) => setPeople(d.people));
    directoryApi.birthdays().then((d) => setBirthdays(d.birthdays));
    channelsApi.list().then((d) => setChannels(d.channels));
  }, []);

  const online = people.filter((p) => p.status === 'online');
  const isAdmin = user?.role === 'admin' || user?.role === 'department_admin';

  return (
    <section className="hub">
      <div className="hub-hero">
        <p className="hub-eyebrow">Company Hub</p>
        <h1 className="hub-greeting">Welcome back</h1>
        <p className="hub-tagline">Everything happening across Zibuke, in one place.</p>
      </div>

      <div className="hub-grid">
        <div className="hub-col">
          {/* Birthdays first when there are any: it's the "celebrate people" moment */}
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
                    <div>
                      <div className="hub-bday-name">{b.full_name}</div>
                      <div className="hub-bday-note">🎂 Birthday today</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <div className="hub-ann-title">{a.title}</div>
                <div className="hub-ann-body">{a.content}</div>
                <div className="hub-ann-meta">
                  {a.author_name} · {new Date(a.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hub-col hub-col-narrow">
          <div className="hub-card">
            <div className="hub-card-head">
              <h3>People online</h3>
              <span className="hub-count">{online.length}</span>
            </div>
            <ul className="hub-people">
              {people.map((p) => (
                <li key={p.id} className="hub-person">
                  <span className={`hub-dot ${p.status === 'online' ? 'is-on' : ''}`} />
                  <span className="hub-avatar" style={{ background: colorFor(p.id) }}>
                    {(p.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="hub-person-info">
                    <span className="hub-person-name">{p.full_name || p.email}</span>
                    {p.job_title && <span className="hub-person-role">{p.job_title}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="hub-card">
            <div className="hub-card-head">
              <h3>Your channels</h3>
            </div>
            <ul className="hub-chan-list">
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
        </div>
      </div>
    </section>
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
