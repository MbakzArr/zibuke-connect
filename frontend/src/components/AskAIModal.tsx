import { useState } from 'react';
import { aiApi } from '../api/resources';

interface AskAIModalProps {
  onClose: () => void;
}

interface Exchange {
  question: string;
  answer: string | null;
  error: string | null;
}

const SUGGESTIONS = [
  'What are my tasks?',
  "What's the latest announcement?",
  "When's the next event?",
];

// Answers questions using announcements, tasks, and events - each pulled
// through the same functions that already scope who's allowed to see
// what, so this never shows anyone anything they couldn't already see on
// the relevant page themselves. Doesn't search live channel messages -
// "Catch me up" on a channel already covers that separately.
export default function AskAIModal({ onClose }: AskAIModalProps) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<Exchange[]>([]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || asking) return;
    setQuestion('');
    setAsking(true);
    const entry: Exchange = { question: text, answer: null, error: null };
    setHistory((prev) => [...prev, entry]);
    try {
      const { answer } = await aiApi.ask(text);
      setHistory((prev) => prev.map((e) => (e === entry ? { ...e, answer } : e)));
    } catch (err: any) {
      const message = err?.message || 'Could not answer that right now.';
      setHistory((prev) => prev.map((e) => (e === entry ? { ...e, error: message } : e)));
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal ai-ask-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>✨ Ask Zibuke AI</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ai-ask-body">
          {history.length === 0 && (
            <>
              <p className="ai-ask-intro">Ask about announcements, your tasks, or upcoming events.</p>
              <div className="ai-ask-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} disabled={asking}>{s}</button>
                ))}
              </div>
            </>
          )}
          {history.length > 0 && (
            <div className="ai-ask-history">
              {history.map((e, i) => (
                <div className="ai-ask-exchange" key={i}>
                  <div className="ai-ask-question">{e.question}</div>
                  {e.error && <div className="ai-ask-error">{e.error}</div>}
                  {!e.error && e.answer === null && <div className="ai-summary-loading">Thinking...</div>}
                  {!e.error && e.answer !== null && <div className="ai-ask-answer">{e.answer}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="ai-ask-input-row">
          <input
            value={question}
            onChange={(ev) => setQuestion(ev.target.value)}
            onKeyDown={(ev) => ev.key === 'Enter' && ask(question)}
            placeholder="Ask something..."
            disabled={asking}
            autoFocus
          />
          <button className="ai-ask-send" onClick={() => ask(question)} disabled={asking || !question.trim()}>
            {asking ? '...' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}
