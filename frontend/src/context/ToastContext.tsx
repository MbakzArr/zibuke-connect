import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastOptions {
  type?: ToastType;
  action?: ToastAction;
  durationMs?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (message: string, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// One global toast queue for the whole app - every "X was created/deleted/
// updated" or "that failed" message goes through here instead of each
// component inventing its own inline banner. Errors stay up longer than
// successes by default (more to read, more likely you needed to notice
// it), and an action (Undo, Retry) keeps the toast up until it's used or
// the person dismisses it.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const { type = 'info', action } = options;
    // Errors and anything with an action (e.g. Undo) get more time by
    // default - a plain success confirmation can be brief.
    const durationMs = options.durationMs ?? (action ? 8000 : type === 'error' ? 6000 : 3500);
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type, action }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, durationMs);
    timers.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
