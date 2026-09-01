import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

// Safety net for the whole app. Without this, an uncaught error ANYWHERE in
// the render tree (e.g. reading a field that turned out to be undefined)
// unmounts the entire React tree and leaves a blank white page - which is
// exactly what happened when a new event's shape was briefly missing a
// field. This won't fix the underlying bug, but it means a future bug like
// it degrades to a friendly message instead of a blank screen requiring a
// manual refresh.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('Uncaught render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h2>Something went wrong</h2>
            <p>This screen hit an unexpected error. Your data is safe - reloading should fix it.</p>
            <button onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
