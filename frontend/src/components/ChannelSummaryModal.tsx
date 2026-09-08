import { useEffect, useState } from 'react';
import { aiApi } from '../api/resources';

interface ChannelSummaryModalProps {
  channelId: string;
  channelName: string;
  // Captured by ChannelView the moment the channel was opened, before
  // this visit's own mark-read update overwrote channel_reads - see the
  // comment there for why this can't just be fetched fresh in here.
  since: string | null;
  onClose: () => void;
}

// "Catch me up" - asks the backend to summarize everything in this channel
// since a given point in time. The backend does the actual AI call (and
// the membership check) - this just shows the result.
export default function ChannelSummaryModal({ channelId, channelName, since, onClose }: ChannelSummaryModalProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    aiApi.summarizeChannel(channelId, since)
      .then((d) => {
        if (cancelled) return;
        setSummary(d.summary);
        setMessageCount(d.messageCount);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Could not generate a summary right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ai-summary-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>✨ Catch me up on #{channelName}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ai-summary-body">
          {loading && <p className="ai-summary-loading">Reading through the channel...</p>}
          {!loading && error && <p className="ai-summary-error">{error}</p>}
          {!loading && !error && messageCount === 0 && (
            <p className="ai-summary-empty">Nothing new since you were last here.</p>
          )}
          {!loading && !error && summary && (
            <>
              <p className="ai-summary-meta">Based on {messageCount} message{messageCount === 1 ? '' : 's'} since you were last here.</p>
              <div className="ai-summary-text">{summary}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
