import { useEffect, useState } from 'react';
import { channelsApi, type JoinRequest } from '../api/resources';
import { useToast } from '../context/ToastContext';
import { colorFor } from '../util/avatarColor';

interface JoinRequestsModalProps {
  channelId: string;
  channelName: string;
  onClose: () => void;
  // Called after any request is resolved, so the caller (ChannelView) can
  // refresh its own pending-count badge without this modal needing to
  // know anything about where that badge lives.
  onResolved?: () => void;
}

// Lists everyone currently asking to join a channel, with Approve/Reject
// per person. Only ever opened by the channel's creator or an admin - the
// backend enforces that regardless, this just assumes whoever opened it
// is allowed to be here.
export default function JoinRequestsModal({ channelId, channelName, onClose, onResolved }: JoinRequestsModalProps) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { showToast } = useToast();

  function load() {
    channelsApi.listJoinRequests(channelId)
      .then((d) => setRequests(d.requests))
      .catch((err) => showToast(err?.message || 'Could not load join requests.', { type: 'error' }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  async function respond(r: JoinRequest, decision: 'approved' | 'rejected') {
    setBusyId(r.id);
    try {
      await channelsApi.respondToJoinRequest(channelId, r.id, decision);
      setRequests((prev) => prev.filter((x) => x.id !== r.id));
      showToast(
        decision === 'approved' ? `${r.full_name || r.email} added to #${channelName}.` : `Request from ${r.full_name || r.email} declined.`,
        { type: 'success' }
      );
      onResolved?.();
    } catch (err: any) {
      showToast(err?.message || 'Could not update that request.', { type: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Requests to join #{channelName}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <ul className="modal-people">
          {requests.map((r) => (
            <li key={r.id}>
              <div className="joinreq-row">
                <span className="modal-avatar" style={{ background: colorFor(r.user_id) }}>
                  {(r.full_name || r.email || '?').charAt(0).toUpperCase()}
                </span>
                <span className="modal-person-info">
                  <span className="modal-person-name">{r.full_name || r.email}</span>
                </span>
                <div className="joinreq-actions">
                  <button
                    className="joinreq-reject"
                    onClick={() => respond(r, 'rejected')}
                    disabled={busyId === r.id}
                  >
                    Decline
                  </button>
                  <button
                    className="joinreq-approve"
                    onClick={() => respond(r, 'approved')}
                    disabled={busyId === r.id}
                  >
                    Approve
                  </button>
                </div>
              </div>
            </li>
          ))}
          {!loading && requests.length === 0 && <li className="modal-empty">No pending requests.</li>}
        </ul>
      </div>
    </div>
  );
}
