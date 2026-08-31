import { useEffect, useState } from 'react';
import { channelsApi, type ChannelMember } from '../api/resources';
import { colorFor } from '../util/avatarColor';

interface MembersModalProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
}

// Lists the members of a channel. Clicking one opens their profile.
export default function MembersModal({ channelId, channelName, onClose, onViewProfile }: MembersModalProps) {
  const [members, setMembers] = useState<ChannelMember[]>([]);

  useEffect(() => {
    channelsApi.members(channelId).then((d) => setMembers(d.members));
  }, [channelId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Members of #{channelName} · {members.length}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <ul className="modal-people">
          {members.map((m) => (
            <li key={m.id}>
              <button className="modal-person" onClick={() => onViewProfile(m.id)}>
                <span className="modal-avatar" style={{ background: colorFor(m.id) }}>
                  {(m.full_name || '?').charAt(0).toUpperCase()}
                </span>
                <span className="modal-person-info">
                  <span className="modal-person-name">{m.full_name || m.email}</span>
                  {m.job_title && <span className="modal-person-role">{m.job_title}</span>}
                </span>
                <span className={`modal-dot ${m.status === 'online' ? 'is-on' : ''}`} />
              </button>
            </li>
          ))}
          {members.length === 0 && <li className="modal-empty">No members.</li>}
        </ul>
      </div>
    </div>
  );
}
