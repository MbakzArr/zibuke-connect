import { useEffect, useState } from 'react';
import { directoryApi, type FullProfile } from '../api/resources';
import { colorFor } from '../util/avatarColor';
import { statusColor, statusLabel } from '../util/status';

interface ProfileModalProps {
  userId: string;
  onClose: () => void;
  onMessage?: (userId: string, name: string) => void;
}

// A person's profile card. Loads the full directory profile and shows the
// public fields. Optional "Message" opens a DM.
export default function ProfileModal({ userId, onClose, onMessage }: ProfileModalProps) {
  const [profile, setProfile] = useState<FullProfile | null>(null);

  useEffect(() => {
    directoryApi.profile(userId).then((d) => setProfile(d.profile));
  }, [userId]);

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

            <dl className="profile-fields">
              {profile.department_name && (
                <div><dt>Department</dt><dd>{profile.department_name}</dd></div>
              )}
              {profile.email && <div><dt>Email</dt><dd>{profile.email}</dd></div>}
              {profile.phone && <div><dt>Phone</dt><dd>{profile.phone}</dd></div>}
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

            {onMessage && (
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
