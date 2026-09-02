import { useEffect, useState } from 'react';
import { directoryApi, type FullProfile } from '../api/resources';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { colorFor } from '../util/avatarColor';
import { statusColor, statusLabel } from '../util/status';

interface ProfileModalProps {
  userId: string;
  onClose: () => void;
  onMessage?: (userId: string, name: string) => void;
}

// A person's profile card. Loads the full directory profile and shows the
// public fields. Optional "Message" opens a DM. If this is your OWN
// profile, an Edit toggle lets you fill in the self-service fields
// (job title, phone, address, LinkedIn, timezone) via PATCH /directory/me -
// that endpoint already existed on the backend but nothing in the UI ever
// called it, which is why these fields sat empty for everyone.
export default function ProfileModal({ userId, onClose, onMessage }: ProfileModalProps) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ jobTitle: '', phone: '', address: '', linkedinUrl: '', timezone: '' });
  const [saving, setSaving] = useState(false);
  const isMe = userId === user?.id;

  useEffect(() => {
    directoryApi.profile(userId).then((d) => {
      setProfile(d.profile);
      setForm({
        jobTitle: d.profile.job_title || '',
        phone: d.profile.phone || '',
        address: d.profile.address || '',
        linkedinUrl: d.profile.linkedin_url || '',
        timezone: d.profile.timezone || '',
      });
    });
  }, [userId]);

  async function save() {
    setSaving(true);
    try {
      const { profile: updated } = await directoryApi.updateMe({
        jobTitle: form.jobTitle.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        timezone: form.timezone.trim(),
      });
      setProfile((prev) => (prev ? { ...prev, ...updated } : prev));
      setEditing(false);
      showToast('Profile updated.', { type: 'success' });
    } catch (err: any) {
      showToast(err?.message || 'Could not save your profile.', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Profile</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {!profile ? (
          <div className="profile-loading">Loading...</div>
        ) : (
          <div className="profile-body">
            <div className="profile-top">
              <span className="profile-avatar" style={{ background: colorFor(profile.id) }}>
                {(profile.full_name || '?').charAt(0).toUpperCase()}
              </span>
              <div>
                <div className="profile-name">{profile.full_name || profile.email}</div>
                {profile.job_title && <div className="profile-role">{profile.job_title}</div>}
                <div className="profile-status">
                  <span className="profile-status-dot" style={{ background: statusColor(profile.status, profile.availability) }} />
                  {statusLabel(profile.status, profile.availability)}
                </div>
              </div>
            </div>

            {editing ? (
              <div className="profile-edit-form">
                <label>Job title
                  <input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} placeholder="e.g. QA Engineer" />
                </label>
                <label>Phone
                  <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="e.g. 082 123 4567" />
                </label>
                <label>Address
                  <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="e.g. Polokwane, Limpopo" />
                </label>
                <label>LinkedIn URL
                  <input value={form.linkedinUrl} onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/..." />
                </label>
                <label>Timezone
                  <input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} placeholder="e.g. Africa/Johannesburg" />
                </label>
                <div className="hub-post-actions">
                  <button className="hub-post-cancel" onClick={() => setEditing(false)}>Cancel</button>
                  <button className="hub-post-send" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            ) : (
              <>
                <dl className="profile-fields">
                  {profile.department_name && (
                    <div><dt>Department</dt><dd>{profile.department_name}</dd></div>
                  )}
                  {profile.email && <div><dt>Email</dt><dd>{profile.email}</dd></div>}
                  {profile.phone && <div><dt>Phone</dt><dd>{profile.phone}</dd></div>}
                  {profile.address && <div><dt>Address</dt><dd>{profile.address}</dd></div>}
                  {profile.timezone && <div><dt>Timezone</dt><dd>{profile.timezone}</dd></div>}
                  {profile.manager_name && (
                    <div><dt>Manager</dt><dd>{profile.manager_name}</dd></div>
                  )}
                  {profile.linkedin_url && (
                    <div>
                      <dt>LinkedIn</dt>
                      <dd><a href={profile.linkedin_url} target="_blank" rel="noreferrer">Profile</a></dd>
                    </div>
                  )}
                </dl>
                {isMe && !profile.phone && !profile.address && !profile.linkedin_url && (
                  <p className="hub-muted">Your directory card is looking bare - add a few details below.</p>
                )}
              </>
            )}

            {isMe && !editing && (
              <button className="profile-msg-btn" onClick={() => setEditing(true)}>
                ✏️ Edit profile
              </button>
            )}
            {!isMe && onMessage && (
              <button
                className="profile-msg-btn"
                onClick={() => onMessage(profile.id, profile.full_name || profile.email)}
              >
                Message
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
